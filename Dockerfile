FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p song-server

FROM debian:bookworm-slim
COPY --from=build /app/target/release/song-server /usr/local/bin/song-server
CMD ["song-server"]