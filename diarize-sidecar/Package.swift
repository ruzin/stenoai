// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "diarize-sidecar",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.15.2"),
    ],
    targets: [
        .executableTarget(
            name: "diarize-sidecar",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio"),
            ],
            path: "Sources"
        ),
    ]
)