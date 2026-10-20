FROM rust:1-bookworm AS build
WORKDIR /app
ENV CARGO_BUILD_JOBS=1
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p song-server

FROM debian:bookworm-slim
COPY --from=build /app/target/release/song-server /usr/local/bin/song-server
CMD ["song-server"]