# syntax=docker/dockerfile:1

# KoreCalendar API: a static Go binary on distroless (no shell, no package manager).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/korecalendar ./cmd/korecalendar

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/korecalendar /usr/local/bin/korecalendar
# docker-compose.yml overrides the user with KORECAL_UID:KORECAL_GID so files in
# the data dir belong to a host user.
USER 65532:65532
# Optional config file; everything can also come from KORECAL_* environment
# variables (see docker-compose.yml). Absolute, so it does not depend on the
# working directory.
ENV KORECAL_CONFIG=/etc/korecal/korecal.toml
EXPOSE 8080
# The image has no curl; the binary checks itself.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["korecalendar", "healthcheck"]
CMD ["korecalendar"]
