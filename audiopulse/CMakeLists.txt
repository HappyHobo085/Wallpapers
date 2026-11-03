cmake_minimum_required(VERSION 3.21)
project(audiopulse LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Qt6 REQUIRED COMPONENTS Core WebSockets)
find_package(PkgConfig REQUIRED)
pkg_check_modules(PIPEWIRE REQUIRED IMPORTED_TARGET libpipewire-0.3)
pkg_check_modules(SYSTEMD REQUIRED IMPORTED_TARGET libsystemd)

add_executable(audiopulse audiopulse.cpp)
target_compile_options(audiopulse PRIVATE -Wall -Wextra)
target_link_libraries(audiopulse PRIVATE
    Qt6::Core Qt6::WebSockets PkgConfig::PIPEWIRE PkgConfig::SYSTEMD)
