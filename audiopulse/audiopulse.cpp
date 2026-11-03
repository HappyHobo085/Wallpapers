// audiopulse — audio spectrum feed for the audio-reactive wallpapers.
//
// Captures whatever the default PipeWire sink is playing, analyses it 60 times
// a second (16 log-spaced bands, bass/mid/high levels, bass-onset beats) and
// pushes the result as a small JSON text frame to every WebSocket client.
//
// Normally started by systemd socket activation (audiopulse.socket listens on
// 127.0.0.1:47800); it exits after kIdleExitMs with no clients and systemd
// starts it again on the next connection. Run by hand it binds the port
// itself and never idles out, which is handy for debugging:
//
//     audiopulse            # then e.g. a WebSocket client on ws://127.0.0.1:47800
//
// Message format, one per analysis frame:
//     {"b":bass,"m":mid,"h":high,"e":beatEnvelope,"n":beatCount,"s":[16 bands]}
// All levels are 0..1 after automatic gain control; "e" jumps to 1 on each
// detected beat and decays; "n" increments on each beat.

#include <QCoreApplication>
#include <QElapsedTimer>
#include <QTimer>
#include <QWebSocket>
#include <QWebSocketServer>

#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#include <systemd/sd-daemon.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <complex>
#include <cstdio>
#include <mutex>
#include <numeric>
#include <vector>

namespace {

constexpr quint16 kPort = 47800;
constexpr int kFFT = 2048;          // ~43 ms window at 48 kHz, 23.4 Hz bins
constexpr int kRing = 8192;         // mono sample history, power of two
constexpr int kBands = 16;
constexpr float kBandLo = 40.0f;    // Hz
constexpr float kBandHi = 16000.0f; // Hz
constexpr int kFrameMs = 16;        // analysis + send rate (~60 Hz)
constexpr int kIdleExitMs = 10000;  // socket-activated only
constexpr qint64 kStaleMs = 150;    // no samples for this long -> silence
constexpr qint64 kMaxBacklog = 64 * 1024; // skip slow clients past this

// --------------------------------------------------------------------------
//  Capture: PipeWire stream on the default sink's monitor, mixed to mono
//  into a ring buffer. The process callback runs on the PipeWire thread.
// --------------------------------------------------------------------------
struct Capture {
    pw_thread_loop *loop = nullptr;
    pw_stream *stream = nullptr;
    spa_hook listener{};

    std::mutex mtx;
    std::array<float, kRing> ring{};
    uint64_t written = 0;               // total mono samples written
    QElapsedTimer sinceWrite;           // guarded by mtx
    std::atomic<uint32_t> rate{48000};
    std::atomic<uint32_t> channels{2};
    std::atomic<bool> failed{false};

    // Copy the newest n samples (oldest first). Returns false when the
    // stream has been quiet for kStaleMs, e.g. the sink is suspended, so the
    // caller treats it as silence instead of re-analysing stale audio.
    bool latest(float *out, int n) {
        std::lock_guard lock(mtx);
        if (written == 0 || !sinceWrite.isValid() || sinceWrite.elapsed() > kStaleMs)
            return false;
        const uint64_t start = written - std::min<uint64_t>(written, n);
        const int have = int(written - start);
        std::fill(out, out + (n - have), 0.0f);
        for (int i = 0; i < have; ++i)
            out[n - have + i] = ring[(start + i) & (kRing - 1)];
        return true;
    }
};

void onProcess(void *data) {
    auto *cap = static_cast<Capture *>(data);
    pw_buffer *b = pw_stream_dequeue_buffer(cap->stream);
    if (!b)
        return;
    const spa_data &d = b->buffer->datas[0];
    if (d.data && d.chunk && d.chunk->size > 0) {
        const auto *s = static_cast<const float *>(SPA_PTROFF(d.data, d.chunk->offset, void));
        const uint32_t ch = std::max<uint32_t>(1, cap->channels.load());
        const uint32_t frames = d.chunk->size / (sizeof(float) * ch);
        std::lock_guard lock(cap->mtx);
        for (uint32_t f = 0; f < frames; ++f) {
            float sum = 0.0f;
            for (uint32_t c = 0; c < ch; ++c)
                sum += s[f * ch + c];
            cap->ring[cap->written & (kRing - 1)] = sum / float(ch);
            ++cap->written;
        }
        cap->sinceWrite.start();
    }
    pw_stream_queue_buffer(cap->stream, b);
}

void onParamChanged(void *data, uint32_t id, const spa_pod *param) {
    auto *cap = static_cast<Capture *>(data);
    if (!param || id != SPA_PARAM_Format)
        return;
    spa_audio_info_raw info{};
    if (spa_format_audio_raw_parse(param, &info) >= 0) {
        if (info.rate)
            cap->rate = info.rate;
        if (info.channels)
            cap->channels = info.channels;
    }
}

void onStateChanged(void *data, pw_stream_state, pw_stream_state state, const char *error) {
    auto *cap = static_cast<Capture *>(data);
    if (state == PW_STREAM_STATE_ERROR) {
        std::fprintf(stderr, "audiopulse: stream error: %s\n", error ? error : "unknown");
        cap->failed = true;
    }
}

const pw_stream_events kStreamEvents = [] {
    pw_stream_events e{};
    e.version = PW_VERSION_STREAM_EVENTS;
    e.state_changed = onStateChanged;
    e.param_changed = onParamChanged;
    e.process = onProcess;
    return e;
}();

bool startCapture(Capture &cap) {
    cap.loop = pw_thread_loop_new("audiopulse", nullptr);
    if (!cap.loop)
        return false;
    pw_properties *props = pw_properties_new(
        PW_KEY_MEDIA_TYPE, "Audio",
        PW_KEY_MEDIA_CATEGORY, "Capture",
        PW_KEY_MEDIA_ROLE, "Music",
        PW_KEY_STREAM_CAPTURE_SINK, "true", // monitor of the default sink
        PW_KEY_NODE_NAME, "audiopulse",
        PW_KEY_APP_NAME, "audiopulse",
        PW_KEY_NODE_LATENCY, "512/48000",
        nullptr);

    pw_thread_loop_lock(cap.loop);
    if (pw_thread_loop_start(cap.loop) < 0) {
        pw_thread_loop_unlock(cap.loop);
        return false;
    }
    cap.stream = pw_stream_new_simple(pw_thread_loop_get_loop(cap.loop), "audiopulse",
                                      props, &kStreamEvents, &cap);
    if (!cap.stream) {
        pw_thread_loop_unlock(cap.loop);
        return false;
    }

    uint8_t buffer[1024];
    spa_pod_builder bld = SPA_POD_BUILDER_INIT(buffer, sizeof(buffer));
    spa_audio_info_raw info{};
    info.format = SPA_AUDIO_FORMAT_F32;
    info.rate = 48000;
    info.channels = 2;
    info.position[0] = SPA_AUDIO_CHANNEL_FL;
    info.position[1] = SPA_AUDIO_CHANNEL_FR;
    const spa_pod *params[1] = {spa_format_audio_raw_build(&bld, SPA_PARAM_EnumFormat, &info)};

    const int res = pw_stream_connect(
        cap.stream, PW_DIRECTION_INPUT, PW_ID_ANY,
        pw_stream_flags(PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS),
        params, 1);
    pw_thread_loop_unlock(cap.loop);
    return res >= 0;
}

// --------------------------------------------------------------------------
//  Analysis
// --------------------------------------------------------------------------
class Analyzer {
public:
    Analyzer() {
        for (int i = 0; i < kFFT; ++i)
            window_[i] = 0.5f - 0.5f * std::cos(2.0f * float(M_PI) * i / (kFFT - 1));
        windowSum_ = std::accumulate(window_.begin(), window_.end(), 0.0f);
        for (int k = 0; k < kFFT / 2; ++k)
            twiddle_[k] = std::polar(1.0f, -2.0f * float(M_PI) * k / kFFT);
        prevLowDb_.fill(-120.0f);
    }

    // Analyse one frame. samples == nullptr means silence.
    QByteArray frame(const float *samples, float rate, float dt) {
        std::array<float, kFFT / 2> mag{};
        if (samples) {
            for (int i = 0; i < kFFT; ++i)
                buf_[i] = {samples[i] * window_[i], 0.0f};
            fft();
            // Scale so a full-scale sine peaks near 1.0 (0 dB).
            const float scale = 2.0f / windowSum_;
            for (int k = 0; k < kFFT / 2; ++k)
                mag[k] = std::abs(buf_[k]) * scale;
        }
        const float binHz = rate / kFFT;

        // --- 16 log bands, in dB ----------------------------------------
        std::array<float, kBands> bandDb{};
        float loudest = -150.0f;
        for (int b = 0; b < kBands; ++b) {
            const float f0 = kBandLo * std::pow(kBandHi / kBandLo, float(b) / kBands);
            const float f1 = kBandLo * std::pow(kBandHi / kBandLo, float(b + 1) / kBands);
            int k0 = std::clamp(int(f0 / binHz), 1, kFFT / 2 - 1);
            int k1 = std::clamp(int(f1 / binHz), k0 + 1, kFFT / 2);
            float p = 0.0f;
            for (int k = k0; k < k1; ++k)
                p += mag[k] * mag[k];
            p /= float(k1 - k0);
            bandDb[b] = 10.0f * std::log10(p + 1e-15f);
            loudest = std::max(loudest, bandDb[b]);
        }

        // --- automatic gain: track a slowly falling peak ----------------
        peakDb_ = std::max(peakDb_ - kPeakFallDbPerS * dt, loudest);
        const float ref = std::max(peakDb_, kMinRefDb);
        const float release = 1.0f - std::exp(-dt / 0.12f);
        for (int b = 0; b < kBands; ++b) {
            const float target = std::clamp((bandDb[b] - (ref - kRangeDb)) / kRangeDb, 0.0f, 1.0f);
            float &v = bands_[b];
            v += (target - v) * (target > v ? 0.6f : release);
        }
        const auto avg = [this](int a, int z) {
            float s = 0.0f;
            for (int i = a; i <= z; ++i)
                s += bands_[i];
            return s / float(z - a + 1);
        };
        const float bass = avg(0, 3), mid = avg(4, 10), high = avg(11, 15);

        // --- beats: positive spectral flux in 30-180 Hz -----------------
        const int lo0 = std::max(1, int(30.0f / binHz));
        const int lo1 = std::min(int(prevLowDb_.size()), std::max(lo0 + 1, int(180.0f / binHz)));
        float flux = 0.0f;
        for (int k = lo0; k < lo1; ++k) {
            const float db = std::max(20.0f * std::log10(mag[k] + 1e-9f), ref - kRangeDb);
            flux += std::max(0.0f, db - prevLowDb_[k]);
            prevLowDb_[k] = db;
        }
        fluxHist_[fluxPos_++ % fluxHist_.size()] = flux;
        const float n = float(fluxHist_.size());
        const float mean = std::accumulate(fluxHist_.begin(), fluxHist_.end(), 0.0f) / n;
        float var = 0.0f;
        for (float f : fluxHist_)
            var += (f - mean) * (f - mean);
        const float sd = std::sqrt(var / n);
        sinceBeat_ += dt;
        if (samples && flux > mean + 1.5f * sd && flux > 6.0f && bass > 0.25f
            && sinceBeat_ > 0.22f) {
            env_ = 1.0f;
            ++beats_;
            sinceBeat_ = 0.0f;
        } else {
            env_ *= std::exp(-dt / 0.18f);
        }

        // --- message ------------------------------------------------------
        char out[512];
        int len = std::snprintf(out, sizeof(out),
                                "{\"b\":%.3f,\"m\":%.3f,\"h\":%.3f,\"e\":%.3f,\"n\":%u,\"s\":[",
                                bass, mid, high, env_, beats_);
        for (int b = 0; b < kBands; ++b)
            len += std::snprintf(out + len, sizeof(out) - len, b ? ",%.3f" : "%.3f", bands_[b]);
        len += std::snprintf(out + len, sizeof(out) - len, "]}");
        return QByteArray(out, len);
    }

private:
    static constexpr float kPeakFallDbPerS = 6.0f;
    static constexpr float kMinRefDb = -60.0f; // quieter than this is "silence"
    static constexpr float kRangeDb = 42.0f;   // dynamic range mapped to 0..1

    void fft() {
        for (int i = 1, j = 0; i < kFFT; ++i) {
            int bit = kFFT >> 1;
            for (; j & bit; bit >>= 1)
                j ^= bit;
            j ^= bit;
            if (i < j)
                std::swap(buf_[i], buf_[j]);
        }
        for (int len = 2; len <= kFFT; len <<= 1) {
            const int stride = kFFT / len;
            for (int i = 0; i < kFFT; i += len) {
                for (int j = 0; j < len / 2; ++j) {
                    const auto u = buf_[i + j];
                    const auto v = buf_[i + j + len / 2] * twiddle_[j * stride];
                    buf_[i + j] = u + v;
                    buf_[i + j + len / 2] = u - v;
                }
            }
        }
    }

    std::array<float, kFFT> window_{};
    float windowSum_ = 1.0f;
    std::array<std::complex<float>, kFFT / 2> twiddle_{};
    std::array<std::complex<float>, kFFT> buf_{};
    std::array<float, kBands> bands_{};
    std::array<float, 16> prevLowDb_{};   // bins up to ~375 Hz at 48 kHz
    std::array<float, 60> fluxHist_{};    // ~1 s of flux history
    size_t fluxPos_ = 0;
    float peakDb_ = -150.0f;
    float env_ = 0.0f;
    float sinceBeat_ = 1.0f;
    unsigned beats_ = 0;
};

} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    pw_init(&argc, &argv);

    Capture cap;
    if (!startCapture(cap)) {
        std::fprintf(stderr, "audiopulse: cannot connect to PipeWire\n");
        return 1;
    }

    QWebSocketServer server(QStringLiteral("audiopulse"), QWebSocketServer::NonSecureMode);
    const int nfds = sd_listen_fds(1);
    const bool activated = nfds >= 1;
    if (activated) {
        if (!server.setSocketDescriptor(SD_LISTEN_FDS_START)) {
            std::fprintf(stderr, "audiopulse: cannot adopt systemd socket\n");
            return 1;
        }
    } else if (!server.listen(QHostAddress::LocalHost, kPort)) {
        std::fprintf(stderr, "audiopulse: cannot listen on 127.0.0.1:%u: %s\n", kPort,
                     qPrintable(server.errorString()));
        return 1;
    }

    QList<QWebSocket *> clients;
    QTimer idle;
    idle.setSingleShot(true);
    idle.setInterval(kIdleExitMs);
    QObject::connect(&idle, &QTimer::timeout, &app, &QCoreApplication::quit);
    if (activated)
        idle.start();

    QObject::connect(&server, &QWebSocketServer::newConnection, [&] {
        while (QWebSocket *c = server.nextPendingConnection()) {
            // Browsers always send an Origin header, so refusing any client
            // that has one stops web pages from reading the feed. Desktop
            // clients (the wallpapers' QML WebSocket) send none.
            if (!c->origin().isEmpty()) {
                c->close(QWebSocketProtocol::CloseCodePolicyViolated,
                         QStringLiteral("browser origins are not allowed"));
                c->deleteLater();
                continue;
            }
            clients.append(c);
            idle.stop();
            QObject::connect(c, &QWebSocket::disconnected, [&, c] {
                clients.removeAll(c);
                c->deleteLater();
                if (activated && clients.isEmpty())
                    idle.start();
            });
        }
    });

    Analyzer analyzer;
    std::vector<float> samples(kFFT);
    QElapsedTimer clock;
    clock.start();
    QTimer tick;
    tick.setTimerType(Qt::PreciseTimer);
    tick.setInterval(kFrameMs);
    QObject::connect(&tick, &QTimer::timeout, [&] {
        if (cap.failed) {
            QCoreApplication::exit(1);
            return;
        }
        const float dt = std::clamp(clock.restart() / 1000.0f, 0.001f, 0.1f);
        if (clients.isEmpty())
            return;
        const bool live = cap.latest(samples.data(), kFFT);
        const QByteArray msg = analyzer.frame(live ? samples.data() : nullptr,
                                              float(cap.rate.load()), dt);
        const QString text = QString::fromLatin1(msg);
        for (QWebSocket *c : std::as_const(clients))
            if (c->bytesToWrite() < kMaxBacklog)
                c->sendTextMessage(text);
    });
    tick.start();

    const int rc = app.exec();

    pw_thread_loop_lock(cap.loop);
    pw_stream_destroy(cap.stream);
    pw_thread_loop_unlock(cap.loop);
    pw_thread_loop_stop(cap.loop);
    pw_thread_loop_destroy(cap.loop);
    pw_deinit();
    return rc;
}
