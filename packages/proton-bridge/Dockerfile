# syntax=docker/dockerfile:1
# Official Proton Mail Bridge, headless. Installs Proton's own signed .deb (never a
# third-party image — this container holds decrypted access to a whole Proton account).
# Trust chain: pinned SHA-256 of the .deb (matches Proton's PKGBUILD + GitHub release
# asset list) AND debsig-verify against Proton's signing key, itself pinned by SHA-256
# and full fingerprint. Bump = new BRIDGE_VERSION + BRIDGE_DEB_SHA256 together.
FROM debian:bookworm-slim

ARG BRIDGE_VERSION=3.27.0
ARG BRIDGE_DEB_SHA256=4ae1f9a38392379a08ab6cfb61b44078a339f55d1d366bbba0a0d9acf901e900
ARG BRIDGE_KEY_SHA256=d5279ed2dc52ffad8875569df0bcca45bd7448bf737fe79722762337e204c221
ARG BRIDGE_KEY_FPR=D51E64D3E63EDC3EEF7864CEE2C75D68E6234B07

COPY bridge.pol /tmp/bridge.pol

# gnupg + pass stay: first-boot keychain generation happens at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg debsig-verify pass socat procps \
  && cd /tmp \
  && curl -fsSLO https://proton.me/download/bridge/bridge_pubkey.gpg \
  && echo "${BRIDGE_KEY_SHA256}  bridge_pubkey.gpg" | sha256sum -c - \
  && [ "$(gpg --show-keys --with-colons bridge_pubkey.gpg | awk -F: '/^fpr/{print $10; exit}')" = "${BRIDGE_KEY_FPR}" ] \
  && mkdir -p /usr/share/debsig/keyrings/E2C75D68E6234B07 /etc/debsig/policies/E2C75D68E6234B07 \
  && gpg --dearmor < bridge_pubkey.gpg > /usr/share/debsig/keyrings/E2C75D68E6234B07/debsig.gpg \
  && mv bridge.pol /etc/debsig/policies/E2C75D68E6234B07/bridge.pol \
  && DEB="protonmail-bridge_${BRIDGE_VERSION}-1_amd64.deb" \
  && curl -fsSLO "https://proton.me/download/bridge/${DEB}" \
  && echo "${BRIDGE_DEB_SHA256}  ${DEB}" | sha256sum -c - \
  && debsig-verify "${DEB}" \
  && apt-get install -y --no-install-recommends "./${DEB}" \
  && apt-get purge -y --auto-remove debsig-verify curl \
  && rm -rf /var/lib/apt/lists/* /tmp/*

RUN useradd -u 1000 -m -d /data bridge
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

USER bridge
ENV HOME=/data GNUPGHOME=/data/.gnupg
# socat relay: Bridge only ever listens on 127.0.0.1:1143, so relay 0.0.0.0:143 -> it.
EXPOSE 143

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -x socat >/dev/null && pgrep -f bridge >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["daemon"]
