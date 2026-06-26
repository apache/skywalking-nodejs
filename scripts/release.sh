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

# Apache SkyWalking NodeJS — release-candidate automation.
#
# Adapted from apache/skywalking-horizon-ui scripts/release.sh for the
# single-package npm layout of skywalking-nodejs. Produces the Apache source
# release, stages it for the vote, and prints the [VOTE] email:
#
#   skywalking-nodejs-src-<v>.tgz {.asc,.sha512}
#
# The post-vote half lives in scripts/release-finalize.sh.
#
# VERSIONING: master carries the in-flight dev version (e.g. 0.9.0-dev), like
# SkyWalking's -SNAPSHOT / horizon-ui's -dev. In a FRESH recursive clone this
# script cuts a release branch, strips the -dev suffix and commits + tags that
# commit (the release candidate), then adds a second commit bumping back to the
# next dev version, and opens ONE PR carrying both. The tag is pushed ONLY AFTER
# the artifacts are built, signed and self-verified, so a build failure never
# leaves a public, immutable release tag behind. Merge the PR after the vote
# passes (master then returns to -dev with the release in its history).
#
# Run interactively on a single-user trusted host (it reads your SVN
# password). Requires bash, but is written to work on macOS bash 3.2.
#
# Usage:  bash scripts/release.sh

set -e -o pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
REPO_URL="${SW_RELEASE_REPO_URL:-https://github.com/apache/skywalking-nodejs.git}"
REPO_BRANCH="${SW_RELEASE_BRANCH:-master}"
GH_REPO="${SW_RELEASE_GH_REPO:-apache/skywalking-nodejs}"
SVN_DEV_URL="https://dist.apache.org/repos/dist/dev/skywalking/node-js"
KEYS_URL="https://dist.apache.org/repos/dist/release/skywalking/KEYS"
WORK_DIR="${SCRIPT_DIR}/.release-work"
CLONE_DIR="${WORK_DIR}/skywalking-nodejs"

# --dry-run / SW_RELEASE_DRY_RUN=1: run the full LOCAL pipeline (clone, strip -dev,
# build, sign, verify) but perform ZERO remote mutations — no tag/branch push, no
# svn upload, no PR. Lets a committer rehearse against the real repo with nothing to undo.
DRY_RUN=false
if [ "${1:-}" = "--dry-run" ] || [ -n "${SW_RELEASE_DRY_RUN:-}" ]; then
    DRY_RUN=true
fi

TEST_FILE=""
# Always clean up the throwaway GPG test file, even on Ctrl-C / early exit.
trap 'rm -f "${TEST_FILE:-}" "${TEST_FILE:-}.asc"' EXIT

# ========================== Helpers ==========================

err()  { echo "ERROR: $*" >&2; }
note() { echo ""; echo "=== $* ==="; }

confirm() {
    local prompt="$1" ans
    read -r -p "${prompt} [y/N] " ans || { err "No input (no TTY?)."; exit 1; }
    [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# Prompt for a required, non-empty value. $1=prompt var-name is echoed back via stdout.
ask() {
    local prompt="$1" val
    read -r -p "${prompt}: " val || { err "No input for '${prompt}' (no TTY?)."; exit 1; }
    [ -n "$val" ] || { err "'${prompt}' must not be empty."; exit 1; }
    printf '%s' "$val"
}

# Read the package.json "version" without jq (runs on stock macOS / Alpine).
read_version() {
    node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$1','utf8')).version)"
}

$DRY_RUN && note "DRY RUN — full local build + sign + verify, but NO tag/branch push, NO svn upload, NO PR"

# ========================== Step 1: GPG signer ==========================
note "Step 1 — GPG signer check"

GPG_KEY_ID=$(git config user.signingkey 2>/dev/null || true)
if [ -z "$GPG_KEY_ID" ]; then
    GPG_KEY_ID=$(gpg --list-secret-keys --keyid-format LONG 2>/dev/null | grep -A1 '^sec' | tail -1 | awk '{print $1}' || true)
fi
if [ -z "$GPG_KEY_ID" ]; then
    err "No GPG secret key found. Configure your Apache GPG key first."
    exit 1
fi

# Match @apache.org against ANY uid of the SELECTED key (not just the first
# uid of a blind dump), and tolerate an empty result without aborting.
GPG_EMAILS=$(gpg --list-keys --with-colons "${GPG_KEY_ID}" 2>/dev/null | awk -F: '/^uid:/{print $10}' || true)
if ! printf '%s\n' "${GPG_EMAILS}" | grep -q '@apache\.org'; then
    err "Key ${GPG_KEY_ID} has no @apache.org uid — Apache releases must be signed with an @apache.org key."
    err "uids found: ${GPG_EMAILS:-<none>}"
    exit 1
fi
echo "GPG Key: ${GPG_KEY_ID}"
gpg --list-keys --keyid-format LONG "${GPG_KEY_ID}" | grep -E '^(pub|uid)' || true
echo "Reminder: this key MUST already be in ${KEYS_URL} — every voter verifies against it."
confirm "Is this the correct signer?" || { echo "Aborted."; exit 1; }

# Pin the signer end-to-end: package.json's release-src honors SW_GPG_KEY
# (gpg -u), so the tarball is signed by THIS key, not gpg's default key.
export SW_GPG_KEY="${GPG_KEY_ID}"

export GPG_TTY=$(tty || true)
echo "Verifying GPG signing works (you may be prompted for the passphrase)…"
TEST_FILE=$(mktemp); echo "test" > "${TEST_FILE}"
if ! gpg --batch --yes -u "${GPG_KEY_ID}" --armor --detach-sig "${TEST_FILE}" 2>/dev/null; then
    err "GPG signing with ${GPG_KEY_ID} failed. Try:  export GPG_TTY=\$(tty)  /  gpgconf --launch gpg-agent"
    exit 1
fi
rm -f "${TEST_FILE}" "${TEST_FILE}.asc"; TEST_FILE=""
echo "GPG signing OK (signer pinned to ${GPG_KEY_ID})."

# ========================== Step 2: Required tools ==========================
note "Step 2 — Tool check"

MISSING=()
for t in gpg svn shasum git gh node npm tar; do
    command -v "$t" >/dev/null || MISSING+=("$t")
done
if [ ${#MISSING[@]} -gt 0 ]; then
    err "Missing required tools: ${MISSING[*]}"
    exit 1
fi
HAVE_LICENSE_EYE=true
command -v license-eye >/dev/null || HAVE_LICENSE_EYE=false
echo "All required tools present.  node: $(node --version)  npm: $(npm --version)"
$HAVE_LICENSE_EYE || echo "NOTE: license-eye not installed — header check will be skipped (CI still enforces it)."

# Node baseline: engines.node >=20, and grpc-tools' node-pre-gyp needs >=18.17.
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]] || { err "Could not parse Node major version ('${NODE_MAJOR}')."; exit 1; }
if [ "${NODE_MAJOR}" -lt 20 ]; then
    err "Node ${NODE_MAJOR}.x is below the >=20 baseline; grpc-tools install may also fail. Use Node 20/22/24."
    exit 1
fi

# ========================== Step 3: Detect version ==========================
note "Step 3 — Detect version"

# master carries the in-flight dev version (e.g. 0.9.0-dev). The release version
# is the bare semver; the next dev version bumps the minor (patch reset to 0).
CURRENT_VERSION=$(read_version "${PROJECT_DIR}/package.json")
[ -n "$CURRENT_VERSION" ] || { err "Could not read version from package.json."; exit 1; }
RELEASE_VERSION="${CURRENT_VERSION%-dev}"
RELEASE_VERSION="${RELEASE_VERSION%-SNAPSHOT}"
if [ "${CURRENT_VERSION}" = "${RELEASE_VERSION}" ]; then
    err "package.json version '${CURRENT_VERSION}' has no -dev/-SNAPSHOT suffix."
    err "master must carry the dev-suffixed version between releases; bump it first."
    exit 1
fi
if ! printf '%s' "${RELEASE_VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    err "Release version '${RELEASE_VERSION}' (from '${CURRENT_VERSION}') is not X.Y.Z."; exit 1
fi
MAJOR=$(printf '%s' "${RELEASE_VERSION}" | cut -d. -f1)
MINOR=$(printf '%s' "${RELEASE_VERSION}" | cut -d. -f2)
NEXT_DEV_VERSION="${MAJOR}.$((MINOR + 1)).0-dev"

echo "Current (master): ${CURRENT_VERSION}"
echo "Release:          ${RELEASE_VERSION}"
echo "Next dev:         ${NEXT_DEV_VERSION}"
if ! confirm "Are these correct?"; then
    RELEASE_VERSION=$(ask "Enter the release version (X.Y.Z)")
    NEXT_DEV_VERSION=$(ask "Enter the next dev version (e.g. 0.10.0-dev)")
    printf '%s' "${RELEASE_VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
        || { err "Release version must be X.Y.Z (got '${RELEASE_VERSION}')."; exit 1; }
    printf '%s' "${NEXT_DEV_VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-dev$' \
        || { err "Next dev version must be X.Y.Z-dev (got '${NEXT_DEV_VERSION}')."; exit 1; }
    [ "${NEXT_DEV_VERSION}" != "${RELEASE_VERSION}" ] \
        || { err "Next dev version must differ from the release version."; exit 1; }
fi
TAG="v${RELEASE_VERSION}"
RELEASE_BRANCH="prepare-release-${RELEASE_VERSION}"

# ========================== Step 4: Consistency check ==========================
note "Step 4 — Consistency check"

for f in LICENSE NOTICE package.json; do
    [ -f "${PROJECT_DIR}/${f}" ] || { err "${f} missing at repo root."; exit 1; }
done
echo "LICENSE / NOTICE / package.json present."
# Soft check: README's advertised baseline should not contradict engines.node.
if grep -qiE 'NodeJS *>= *([0-9]|1[0-9])\b' "${PROJECT_DIR}/README.md" 2>/dev/null &&
   ! grep -qiE 'NodeJS *>= *2[0-9]' "${PROJECT_DIR}/README.md" 2>/dev/null; then
    echo "WARN: README.md advertises a Node baseline below 20 while engines.node is >=20. Fix before tagging."
fi

# ========================== Step 5: License-header check ==========================
if $HAVE_LICENSE_EYE; then
    note "Step 5 — License-header check (license-eye)"
    (cd "${PROJECT_DIR}" && license-eye -c .licenserc.yaml header check)
    echo "License headers OK."
else
    note "Step 5 — License-header check SKIPPED (license-eye absent; CI enforces it)"
fi

# ========================== Step 6: Clone fresh, strip -dev, commit + tag LOCALLY ==========================
note "Step 6 — Fresh clone, strip -dev, commit + local tag ${TAG}"

rm -rf "${WORK_DIR}"; mkdir -p "${WORK_DIR}"
# --recurse-submodules is MANDATORY: protocol/ holds the .proto sources;
# without it prepare->protoc.sh codegens nothing (Step 8 guards against this).
echo "Cloning ${REPO_URL} (branch ${REPO_BRANCH}) with submodules…"
git clone --recurse-submodules --branch "${REPO_BRANCH}" "${REPO_URL}" "${CLONE_DIR}"

CLONE_VERSION=$(read_version "${CLONE_DIR}/package.json")
if [ "${CLONE_VERSION}" != "${CURRENT_VERSION}" ]; then
    err "Fresh clone of ${REPO_BRANCH} has version ${CLONE_VERSION}, expected ${CURRENT_VERSION}."
    err "Re-run after ${REPO_BRANCH} settles, or fix its package.json version."
    exit 1
fi

cd "${CLONE_DIR}"
# Capture ls-remote success explicitly: a FAILED ls-remote must not be read
# as "tag/branch absent" (which would let us re-create an existing one).
REMOTE_TAGS=$(git ls-remote --tags origin) || { err "git ls-remote origin failed; cannot verify ${TAG} is unused."; exit 1; }
if printf '%s\n' "${REMOTE_TAGS}" | grep -q "refs/tags/${TAG}$"; then
    err "Tag ${TAG} already exists on origin. Delete it first to re-cut, or pick a new version."
    exit 1
fi
REMOTE_HEADS=$(git ls-remote --heads origin "${RELEASE_BRANCH}") || { err "git ls-remote origin failed."; exit 1; }
if [ -n "${REMOTE_HEADS}" ]; then
    err "Branch ${RELEASE_BRANCH} already exists on origin. Close/delete it first to re-cut."
    exit 1
fi

# The release commit lands via PR (master is protected). Cut a dedicated branch;
# the tag points at the version-strip commit, and the next-dev bump is added as a
# second commit on the SAME branch in Step 9 — so one PR carries both.
git checkout -q -b "${RELEASE_BRANCH}"
npm version "${RELEASE_VERSION}" --no-git-tag-version --allow-same-version >/dev/null
# Install deps BEFORE committing so the committed (and tagged) lockfile is exactly
# the one the tarball ships — no post-build drift. This also runs prepare->protoc.sh
# (needs the protocol/ submodule + grpc-tools; on Apple Silicon protoc runs via Rosetta).
npm install
git add package.json package-lock.json
git commit -q --no-verify -m "Prepare release ${RELEASE_VERSION}"
# Tag the version-strip commit LOCALLY only. It is pushed in Step 9, AFTER the
# artifacts are built + verified — never before. Use ^{commit} so RELEASE_COMMIT is
# the COMMIT sha (an annotated tag's own object sha would 404 in the vote email).
git tag -a "${TAG}" -m "Release Apache SkyWalking-NodeJS ${RELEASE_VERSION}"
RELEASE_COMMIT=$(git rev-parse "${TAG}^{commit}")
echo "Branch ${RELEASE_BRANCH} + local tag ${TAG} at ${RELEASE_COMMIT} (NOT pushed yet)."

# ========================== Step 7: Build + sign source release ==========================
note "Step 7 — Build + sign source tarball (npm run release-src)"

# Deps were installed in Step 6 (before the commit). release-src runs prepare
# (protoc) + package-src (tar) + gpg detached sig (signer pinned via SW_GPG_KEY)
# + sha512, from the tagged working tree.
npm run release-src

SRC_TGZ="skywalking-nodejs-src-${RELEASE_VERSION}.tgz"
for f in "${SRC_TGZ}" "${SRC_TGZ}.asc" "${SRC_TGZ}.sha512"; do
    [ -f "${CLONE_DIR}/${f}" ] || { err "Expected artifact ${f} not produced by release-src."; exit 1; }
    cp "${CLONE_DIR}/${f}" "${WORK_DIR}/"
done

# ========================== Step 8: Verify the tarball ==========================
note "Step 8 — Verify artifact contents + signature"

cd "${WORK_DIR}"
PROTO_COUNT=$(tar -tzf "${SRC_TGZ}" | grep -cE 'protocol/.*\.proto' || true)
[ "${PROTO_COUNT}" -gt 0 ] || { err "Tarball contains 0 protocol/*.proto — submodule was empty. Aborting."; exit 1; }
if ! tar -tzf "${SRC_TGZ}" | grep -qE '(^|/)LICENSE$'; then err "Tarball missing LICENSE."; exit 1; fi
if ! tar -tzf "${SRC_TGZ}" | grep -qE '(^|/)NOTICE$';  then err "Tarball missing NOTICE.";  exit 1; fi
if   tar -tzf "${SRC_TGZ}" | grep -q 'node_modules/';  then err "Tarball unexpectedly contains node_modules/."; exit 1; fi
echo "Contents OK: ${PROTO_COUNT} .proto files, LICENSE + NOTICE present, no node_modules."

shasum -a 512 -c "${SRC_TGZ}.sha512"
gpg --verify "${SRC_TGZ}.asc" "${SRC_TGZ}"
echo "Checksum + signature self-verify OK."
echo "Artifacts:"; ls -lh "${WORK_DIR}/${SRC_TGZ}" "${WORK_DIR}/${SRC_TGZ}.asc" "${WORK_DIR}/${SRC_TGZ}.sha512"

# ========================== Step 9: Push tag + branch, next-dev bump, open PR ==========================
note "Step 9 — Push tag ${TAG} + branch ${RELEASE_BRANCH}, open the release PR"

cd "${CLONE_DIR}"
# Add the next-dev bump as a SECOND commit on the branch so one PR carries both:
# version strip (tagged commit 1) -> back to -dev (commit 2). The tag stays on
# commit 1. (checkout guards against any stray working-tree drift first.)
git checkout -q -- package.json package-lock.json 2>/dev/null || true
npm version "${NEXT_DEV_VERSION}" --no-git-tag-version >/dev/null
git add package.json package-lock.json
git commit -q --no-verify -m "Prepare next release ${NEXT_DEV_VERSION}"

TAG_PUSHED=false
if $DRY_RUN; then
    echo "DRY RUN: prepared branch ${RELEASE_BRANCH} (2 commits) + local tag ${TAG} in ${CLONE_DIR}."
    echo "DRY RUN: skipping push of branch + tag and the release PR."
elif confirm "Artifacts built + verified. Push tag ${TAG} + branch ${RELEASE_BRANCH} (atomic) and open the release PR now?"; then
    # --atomic: both refs land together or neither, avoiding a branch-without-tag
    # half-state that the re-run guards would then trip on.
    git push --atomic origin "${RELEASE_BRANCH}" "${TAG}"
    TAG_PUSHED=true
    echo "Pushed ${RELEASE_BRANCH} + ${TAG}."
    if gh pr create --repo "${GH_REPO}" --base "${REPO_BRANCH}" --head "${RELEASE_BRANCH}" \
        --title "Release ${RELEASE_VERSION}, bump to ${NEXT_DEV_VERSION}" \
        --body "Release branch for ${RELEASE_VERSION} — two commits: strip -dev (tagged ${TAG}, the RC the vote runs against) and bump to ${NEXT_DEV_VERSION}. Merge AFTER the [VOTE] passes; the ${TAG} tag stays pinned to the release commit."; then
        echo "Opened release PR: ${RELEASE_BRANCH} -> ${REPO_BRANCH}."
    else
        echo "Could not open the PR automatically — open it by hand (${RELEASE_BRANCH} -> ${REPO_BRANCH})."
    fi
else
    echo "Tag ${TAG} + branch ${RELEASE_BRANCH} NOT pushed; the prepared clone is in ${CLONE_DIR}."
    echo "To finish by hand: git -C ${CLONE_DIR} push --atomic origin ${RELEASE_BRANCH} ${TAG}, then open the PR."
fi

# ========================== Step 10: Upload RC to svn dev ==========================
note "Step 10 — Upload RC to ${SVN_DEV_URL}/${RELEASE_VERSION}"

UPLOADED=false
if $DRY_RUN; then
    echo "DRY RUN: skipping svn upload to ${SVN_DEV_URL}/${RELEASE_VERSION}."
elif confirm "Upload the release candidate to svn dev now?"; then
    # NOTE: svn takes the password on argv (--password), so it is briefly
    # visible in `ps`. Run this only on a single-user trusted host and never
    # with `set -x`. The password is cleared from the environment below.
    SVN_USER=$(ask "Apache SVN username")
    read -r -s -p "Apache SVN password: " SVN_PASS || { err "No SVN password (no TTY?)."; exit 1; }
    echo ""
    [ -n "$SVN_PASS" ] || { err "SVN password must not be empty."; exit 1; }
    SVN_AUTH=(--username "${SVN_USER}" --password "${SVN_PASS}" --non-interactive --no-auth-cache)

    SVN_STAGE="${WORK_DIR}/svn-staging"
    rm -rf "${SVN_STAGE}"
    svn co --depth empty "${SVN_AUTH[@]}" "${SVN_DEV_URL}" "${SVN_STAGE}"
    SVN_VERSION_DIR="${SVN_STAGE}/${RELEASE_VERSION}"
    if svn ls "${SVN_AUTH[@]}" "${SVN_DEV_URL}/${RELEASE_VERSION}" >/dev/null 2>&1; then
        echo "Version folder exists on svn — updating in place."
        svn update "${SVN_AUTH[@]}" --set-depth infinity "${SVN_VERSION_DIR}"
    else
        mkdir -p "${SVN_VERSION_DIR}"
    fi
    cp "${WORK_DIR}/${SRC_TGZ}" "${WORK_DIR}/${SRC_TGZ}.asc" "${WORK_DIR}/${SRC_TGZ}.sha512" "${SVN_VERSION_DIR}/"
    (cd "${SVN_STAGE}" && svn add --force "${RELEASE_VERSION}" || true)
    (cd "${SVN_STAGE}" && svn commit "${SVN_AUTH[@]}" -m "Draft Apache SkyWalking-NodeJS release ${RELEASE_VERSION}")
    UPLOADED=true
    echo "Uploaded: ${SVN_DEV_URL}/${RELEASE_VERSION}"
    unset SVN_PASS; unset SVN_AUTH
else
    echo "Skipped svn upload. Artifacts are in ${WORK_DIR}/."
fi

# ========================== Step 11: Vote email ==========================
note "Step 11 — Vote email"

if ! $TAG_PUSHED || ! $UPLOADED; then
    echo "WARNING: tag pushed=${TAG_PUSHED}, RC uploaded=${UPLOADED}."
    echo "         Some links in the email below are DEAD until you push the tag and/or upload the RC."
    echo ""
fi

SRC_SHA512=$(cat "${WORK_DIR}/${SRC_TGZ}.sha512")
VOTE_DATE=$(LC_ALL=C date +"%B %d, %Y")

cat <<EOF

========================================================================
Vote Email — copy and send to dev@skywalking.apache.org
========================================================================

Subject: [VOTE] Release Apache SkyWalking NodeJS version ${RELEASE_VERSION}

Hi the SkyWalking Community,

This is a call for vote to release Apache SkyWalking NodeJS version ${RELEASE_VERSION}.

Release notes:

 * https://github.com/apache/skywalking-nodejs/releases/tag/${TAG}

Release Candidate:

 * ${SVN_DEV_URL}/${RELEASE_VERSION}
 * sha512 checksums
   - ${SRC_SHA512}

Release Tag :

 * (Git Tag) ${TAG}

Release Commit Hash :

 * https://github.com/apache/skywalking-nodejs/tree/${RELEASE_COMMIT}

Keys to verify the Release Candidate :

 * ${KEYS_URL}

Guide to build the release from source :

 * https://github.com/apache/skywalking-nodejs/blob/${TAG}/CONTRIBUTING.md#compiling-and-building

Voting will start now (${VOTE_DATE}) and will remain open for at least 72 hours.
A release passes with at least 3 binding +1 (PMC) votes and more +1 than -1.

[ ] +1 Release this package.
[ ] +0 No opinion.
[ ] -1 Do not release this package because....

Thanks.

[1] https://github.com/apache/skywalking-nodejs/blob/master/docs/How-to-release.md#vote-check
========================================================================
EOF

note "Done — $($DRY_RUN && echo 'DRY RUN for' || echo 'release candidate') ${RELEASE_VERSION}$($DRY_RUN || echo ' staged')"
$DRY_RUN && echo "  (DRY RUN: nothing was pushed/uploaded; the prepared clone is in ${CLONE_DIR}.)"
echo "  Tag:             ${TAG} ($($TAG_PUSHED && echo pushed || echo 'NOT pushed'))"
echo "  Artifacts:       ${WORK_DIR}/${SRC_TGZ}{,.asc,.sha512}"
echo "  svn dev staging: $($UPLOADED && echo "${SVN_DEV_URL}/${RELEASE_VERSION}" || echo 'NOT uploaded')"
echo ""
echo "Next steps:"
echo "  1. Draft the GitHub release notes (auto-generated; CHANGELOG.md is a stub):"
echo "       gh release create ${TAG} --draft --generate-notes --verify-tag \\"
echo "         --notes-start-tag <previous tag> --title \"${RELEASE_VERSION}\""
echo "  2. Send the [VOTE] email above to dev@skywalking.apache.org (>=72h)."
echo "  3. After the vote passes:"
echo "       - run:  bash scripts/release-finalize.sh"
echo "       - merge the release PR (${RELEASE_BRANCH} -> ${REPO_BRANCH}); ${REPO_BRANCH} returns to ${NEXT_DEV_VERSION}, tag ${TAG} stays put."
