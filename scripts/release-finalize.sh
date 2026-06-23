#!/usr/bin/env bash

#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# Apache SkyWalking NodeJS — POST-VOTE release finalization.
#
# Run AFTER the [VOTE] on dev@skywalking.apache.org passes (>=72h, >=3
# binding +1, more +1 than -1). Second half of the flow; scripts/release.sh
# is the first half.
#
# In order:
#   1. Promote on svn: server-side move dev/<v>/ -> release/<v>/, then remove
#      the PREVIOUS (strictly-older) release (auto-archived to archive.apache.org).
#   2. Cut/publish the GitHub release on tag v<v> with auto-generated notes,
#      attaching the SAME voted bytes fetched back from svn release (checksum
#      AND signature verified before attaching).
#   3. (optional, IRREVERSIBLE) publish skywalking-backend-js@<v> to npm,
#      built from a fresh clone of the tag.
#
# Every irreversible step confirms first. Run on a single-user trusted host.
#
# Usage:  bash scripts/release-finalize.sh

set -e -o pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
GH_REPO="apache/skywalking-nodejs"
NPM_PACKAGE="skywalking-backend-js"
REPO_URL="${SW_RELEASE_REPO_URL:-https://github.com/apache/skywalking-nodejs.git}"
SVN_DEV_URL="https://dist.apache.org/repos/dist/dev/skywalking/node-js"
SVN_RELEASE_URL="https://dist.apache.org/repos/dist/release/skywalking/node-js"
KEYS_URL="https://dist.apache.org/repos/dist/release/skywalking/KEYS"
WORK_DIR="${SCRIPT_DIR}/.finalize-work"

# ========================== Helpers ==========================

err()  { echo "ERROR: $*" >&2; }
note() { echo ""; echo "=== $* ==="; }

confirm() {
    local prompt="$1" ans
    read -r -p "${prompt} [y/N] " ans || { err "No input (no TTY?)."; exit 1; }
    [[ "$ans" == "y" || "$ans" == "Y" ]]
}

ask() {
    local prompt="$1" val
    read -r -p "${prompt}: " val || { err "No input for '${prompt}' (no TTY?)."; exit 1; }
    [ -n "$val" ] || { err "'${prompt}' must not be empty."; exit 1; }
    printf '%s' "$val"
}

svn_exists() { svn ls "$1" >/dev/null 2>&1; }

# ========================== Step 1: Preflight ==========================
note "Step 1 — Tool + auth preflight"

MISSING=()
for t in svn gh git node npm gpg shasum curl; do
    command -v "$t" >/dev/null || MISSING+=("$t")
done
if [ ${#MISSING[@]} -gt 0 ]; then err "Missing required tools: ${MISSING[*]}"; exit 1; fi
gh auth status >/dev/null 2>&1 || { err "gh is not authenticated. Run: gh auth login"; exit 1; }
# Fetch tags up front so version auto-detect (Step 2) sees the RC tag even on
# a checkout that never pulled it.
(cd "${PROJECT_DIR}" && git fetch --tags --quiet origin) || err "git fetch --tags failed (continuing with local tags)."
echo "gh authenticated; tools present."

# ========================== Step 2: Detect version ==========================
note "Step 2 — Detect release version"

DETECTED=$(cd "${PROJECT_DIR}" && git tag --list 'v*' --sort=-version:refname | head -1 | sed 's/^v//')
echo "Most recent git tag: v${DETECTED:-<none>}"
read -r -p "Release version to finalize [${DETECTED}]: " RELEASE_VERSION || { err "No input (no TTY?)."; exit 1; }
RELEASE_VERSION="${RELEASE_VERSION:-${DETECTED}}"
[ -n "${RELEASE_VERSION}" ] || { err "No release version provided."; exit 1; }
TAG="v${RELEASE_VERSION}"
SRC_TGZ="skywalking-nodejs-src-${RELEASE_VERSION}.tgz"

# The tag MUST exist locally (we fetched in Step 1) — fail loudly, not later
# inside an opaque gh error.
(cd "${PROJECT_DIR}" && git rev-parse "${TAG}" >/dev/null 2>&1) || {
    err "Tag ${TAG} not found locally or on origin. Did scripts/release.sh push it?"; exit 1; }
echo "Finalizing ${RELEASE_VERSION} (tag ${TAG})."
confirm "Proceed?" || { echo "Aborted."; exit 1; }

rm -rf "${WORK_DIR}"; mkdir -p "${WORK_DIR}"

# ========================== Step 3: svn move dev -> release ==========================
note "Step 3 — Promote on svn: dev (RC) -> release (official)"

echo "  FROM (release candidate): ${SVN_DEV_URL}/${RELEASE_VERSION}/"
echo "  TO   (official release):  ${SVN_RELEASE_URL}/${RELEASE_VERSION}/"

# NOTE: svn takes the password on argv; run only on a trusted host, never with set -x.
SVN_USER=$(ask "Apache SVN username")
read -r -s -p "Apache SVN password: " SVN_PASS || { err "No SVN password (no TTY?)."; exit 1; }
echo ""
[ -n "$SVN_PASS" ] || { err "SVN password must not be empty."; exit 1; }
SVN_AUTH=(--username "${SVN_USER}" --password "${SVN_PASS}" --non-interactive --no-auth-cache)

if ! svn ls "${SVN_AUTH[@]}" "${SVN_DEV_URL}/${RELEASE_VERSION}" >/dev/null 2>&1; then
    err "Release candidate not found at ${SVN_DEV_URL}/${RELEASE_VERSION}/. Did scripts/release.sh upload it?"
    exit 1
fi

if svn ls "${SVN_AUTH[@]}" "${SVN_RELEASE_URL}/${RELEASE_VERSION}" >/dev/null 2>&1; then
    echo "Already present at release/${RELEASE_VERSION} — skipping the move (idempotent)."
else
    if ! svn ls "${SVN_AUTH[@]}" "${SVN_RELEASE_URL}" >/dev/null 2>&1; then
        echo "Creating ${SVN_RELEASE_URL}/ …"
        svn mkdir --parents "${SVN_AUTH[@]}" -m "Create SkyWalking NodeJS release directory" "${SVN_RELEASE_URL}"
    fi
    if confirm "Run the server-side svn mv now? (PMC-only action)"; then
        svn mv "${SVN_AUTH[@]}" -m "Release Apache SkyWalking-NodeJS ${RELEASE_VERSION}" \
            "${SVN_DEV_URL}/${RELEASE_VERSION}" "${SVN_RELEASE_URL}/${RELEASE_VERSION}"
        echo "Moved to ${SVN_RELEASE_URL}/${RELEASE_VERSION}/"
    else
        err "svn move skipped — cannot continue without the official artifacts."
        exit 1
    fi
fi

# Remove ONLY a strictly-older previous release (never the one being released,
# never a newer one). ASF keeps only the current release live; older versions
# stay downloadable from archive.apache.org.
PREV_RELEASE=$(svn ls "${SVN_AUTH[@]}" "${SVN_RELEASE_URL}/" 2>/dev/null \
    | sed 's,/$,,' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | grep -vx "${RELEASE_VERSION}" \
    | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true)
if [ -n "${PREV_RELEASE}" ]; then
    if printf '%s\n%s\n' "${PREV_RELEASE}" "${RELEASE_VERSION}" \
         | sort -t. -k1,1n -k2,2n -k3,3n -C 2>/dev/null && [ "${PREV_RELEASE}" != "${RELEASE_VERSION}" ]; then
        echo "Previous release to retire: ${SVN_RELEASE_URL}/${PREV_RELEASE}/"
        read -r -p "To remove it, type the version '${PREV_RELEASE}' exactly (blank = keep): " TYPED || TYPED=""
        if [ "${TYPED}" = "${PREV_RELEASE}" ]; then
            svn rm "${SVN_AUTH[@]}" -m "Remove superseded release ${PREV_RELEASE} (archived)" \
                "${SVN_RELEASE_URL}/${PREV_RELEASE}"
            echo "Removed release/${PREV_RELEASE}/."
        else
            echo "Kept release/${PREV_RELEASE}/."
        fi
    else
        echo "WARN: latest other release ${PREV_RELEASE} is not strictly older than ${RELEASE_VERSION}; not removing anything."
    fi
fi
unset SVN_PASS; unset SVN_AUTH
echo "Allow ~a few minutes for mirror propagation to downloads.apache.org before updating website links."

# ========================== Step 4: GitHub release ==========================
note "Step 4 — GitHub release ${TAG}"

# Fetch the VOTED bytes back from svn release so the GitHub release attaches
# byte-identical files to what the PMC voted on (not a fresh rebuild).
ART_DIR="${WORK_DIR}/artifacts"; mkdir -p "${ART_DIR}"
for f in "${SRC_TGZ}" "${SRC_TGZ}.asc" "${SRC_TGZ}.sha512"; do
    echo "Fetching ${f}…"
    curl -fSL -o "${ART_DIR}/${f}" "${SVN_RELEASE_URL}/${RELEASE_VERSION}/${f}"
done
(cd "${ART_DIR}" && shasum -a 512 -c "${SRC_TGZ}.sha512")
# Re-verify the binding signature too (not just the checksum).
(cd "${ART_DIR}" && gpg --verify "${SRC_TGZ}.asc" "${SRC_TGZ}") \
    || { err "GPG signature verify failed on the fetched release artifact. Is the signing key in ${KEYS_URL}?"; exit 1; }
echo "Checksum + signature verified."

if gh release view "${TAG}" --repo "${GH_REPO}" >/dev/null 2>&1; then
    echo "GitHub release ${TAG} already exists."
    if confirm "Publish it (clear draft, mark latest) and (re)upload the voted artifacts?"; then
        gh release edit "${TAG}" --repo "${GH_REPO}" --draft=false --latest
        gh release upload "${TAG}" --repo "${GH_REPO}" --clobber \
            "${ART_DIR}/${SRC_TGZ}" "${ART_DIR}/${SRC_TGZ}.asc" "${ART_DIR}/${SRC_TGZ}.sha512"
        echo "GitHub release published."
    fi
else
    PREV_TAG=$(cd "${PROJECT_DIR}" && git tag --list 'v*' --sort=-version:refname | grep -vx "${TAG}" | head -1)
    if confirm "Create GitHub release ${TAG} (auto-notes since ${PREV_TAG:-<none>}) and attach the artifacts?"; then
        gh release create "${TAG}" --repo "${GH_REPO}" \
            --title "Apache SkyWalking NodeJS ${RELEASE_VERSION}" \
            --generate-notes ${PREV_TAG:+--notes-start-tag "${PREV_TAG}"} --latest \
            "${ART_DIR}/${SRC_TGZ}" "${ART_DIR}/${SRC_TGZ}.asc" "${ART_DIR}/${SRC_TGZ}.sha512"
        echo "GitHub release created."
    fi
fi

# ========================== Step 5: npm publish (optional, IRREVERSIBLE) ==========================
note "Step 5 — npm publish ${NPM_PACKAGE}@${RELEASE_VERSION} (optional, IRREVERSIBLE)"

if npm view "${NPM_PACKAGE}@${RELEASE_VERSION}" version >/dev/null 2>&1; then
    echo "${NPM_PACKAGE}@${RELEASE_VERSION} is already on npm — skipping publish (immutable)."
elif confirm "Publish ${NPM_PACKAGE}@${RELEASE_VERSION} to npm now? (binding artifact is the svn tarball; npm is a convenience)"; then
    NPM_USER=$(npm whoami 2>/dev/null || true)
    [ -n "${NPM_USER}" ] || { err "Not logged in to npm. Run: npm login"; exit 1; }
    echo "npm user: ${NPM_USER}"

    # Build + publish from a FRESH clone of the tag so the published bytes
    # match the released tag exactly (not your working tree).
    PUB_DIR="${WORK_DIR}/publish-clone"
    git clone --recurse-submodules --branch "${TAG}" "${REPO_URL}" "${PUB_DIR}"
    cd "${PUB_DIR}"
    npm install
    npm run build
    [ -f lib/index.js ] || { err "npm run build did not produce lib/index.js — aborting publish."; exit 1; }
    PUB_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
    [ "${PUB_VERSION}" = "${RELEASE_VERSION}" ] || { err "Clone version ${PUB_VERSION} != ${RELEASE_VERSION}."; exit 1; }
    npm publish --dry-run
    if confirm "Dry-run looks correct — run the REAL npm publish?"; then
        if [ -n "${NPM_OTP:-}" ]; then npm publish --otp="${NPM_OTP}"; else npm publish; fi
        echo "Published ${NPM_PACKAGE}@${RELEASE_VERSION}."
    else
        echo "Skipped real npm publish."
    fi
    cd "${PROJECT_DIR}"
else
    echo "Skipped npm publish."
fi

# ========================== Done ==========================
note "Done — ${RELEASE_VERSION} finalized"
echo "  svn release: ${SVN_RELEASE_URL}/${RELEASE_VERSION}/"
echo "  GitHub:      https://github.com/${GH_REPO}/releases/tag/${TAG}"
echo "  npm:         https://www.npmjs.com/package/${NPM_PACKAGE}"
echo ""
echo "Remaining MANUAL steps:"
echo "  1. Website PR (apache/skywalking-website): add the release event, bump the"
echo "     NodeJS Agent block in data/releases.yml and the docs pointer in data/docs.yml."
echo "  2. Send the [ANNOUNCE] email from your @apache.org address to"
echo "     dev@skywalking.apache.org and announce@apache.org."
echo ""
echo "Working files left in ${WORK_DIR}/ (safe to delete)."
