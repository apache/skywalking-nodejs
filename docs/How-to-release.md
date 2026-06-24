# Apache SkyWalking NodeJS Release Guide

This guide releases SkyWalking NodeJS the Apache Way using the two release scripts, and helps
voters check a release. The scripts — [`scripts/release.sh`](../scripts/release.sh)
(`npm run release`) and [`scripts/release-finalize.sh`](../scripts/release-finalize.sh)
(`npm run release:finalize`) — do the mechanical work (versioning, tagging, signing, svn staging,
the GitHub release, npm); this guide covers the human steps around them (GPG/KEYS, the vote, the
announce).

`master` carries the in-flight dev version (e.g. `0.9.0-dev`), like SkyWalking's `-SNAPSHOT`. You
do **not** edit `package.json` by hand — `npm run release` strips `-dev` for the release commit and
bumps the branch back to the next `-dev` in the same PR.

## The release scripts

The whole flow is three commands (steps 1–3 below detail each phase):

```shell
npm run release -- --dry-run     # rehearse: full local build + sign + verify, NO push/svn/PR
npm run release                  # cut the RC: tag, sign, svn-stage, open the release PR, print the [VOTE] email
# ... [VOTE] on dev@skywalking.apache.org for >= 72h, >= 3 binding +1 ...
npm run release:finalize         # promote svn dev -> release, publish the GitHub release, optional npm publish
```

Both scripts are **interactive** (every irreversible step asks `y/N`), must run on a single trusted
host (they read your SVN password), and are heavily commented — read
[`scripts/release.sh`](../scripts/release.sh) / [`scripts/release-finalize.sh`](../scripts/release-finalize.sh)
for the details. Knobs (all optional):

| Variable / flag | Effect | Default |
| :--- | :--- | :--- |
| `--dry-run` or `SW_RELEASE_DRY_RUN=1` | Run everything locally, perform **no** remote mutation (no tag/branch push, no svn, no PR) | off |
| `SW_RELEASE_REPO_URL` | Git repo to clone + push | `https://github.com/apache/skywalking-nodejs.git` |
| `SW_RELEASE_BRANCH` | Branch to cut from | `master` |
| `SW_RELEASE_GH_REPO` | `owner/repo` for the release PR / GitHub release | `apache/skywalking-nodejs` |
| `SW_GPG_KEY` | Pin the signing key (`release.sh` sets this from your `@apache.org` key automatically) | git/gpg default |
| `NPM_OTP` | npm one-time password for the `release:finalize` publish | prompt |

> Tip: `unset SW_RELEASE_REPO_URL SW_RELEASE_BRANCH SW_RELEASE_GH_REPO` before a real release —
> a stray override from an earlier test would otherwise retarget the clone/push.

## Prerequisites (one-time)

- **Apache GPG key** with an `@apache.org` uid, added to the SkyWalking `KEYS` file:
  1. Upload the public key to a keyserver (e.g. [MIT](http://pgp.mit.edu:11371/)).
  1. Register the fingerprint at [id.apache.org](https://id.apache.org/).
  1. **Append** (never overwrite) your key to the [SkyWalking KEYS](https://dist.apache.org/repos/dist/release/skywalking/KEYS)
     file — **PMC only**; ask a PMC member if needed.
- **Tools**: Node >= 20, plus `git`, `svn`, `gh`, `gpg`, `shasum`, `tar` (and `license-eye`,
  optional). Run `gh auth login`; for the npm publish, `npm login` as a maintainer of
  `skywalking-backend-js`.
- **Milestones**: close/roll the milestone on
  [skywalking-nodejs](https://github.com/apache/skywalking-nodejs/milestones) and
  [skywalking](https://github.com/apache/skywalking/milestones), and create the next one.

Run the scripts on a single-user trusted host (they read your SVN password).

## 1. Cut the release candidate — `npm run release`

```shell
npm run release -- --dry-run     # rehearse first: full local build + sign + verify, NO push/svn/PR
npm run release                  # the real cut
```

`npm run release` does, each irreversible step behind a `y/N`:

1. preflight — the GPG signer is an `@apache.org` key, required tools present, Node >= 20;
1. fresh recursive clone of `master`; cut a `prepare-release-<v>` branch; strip `-dev` and
   commit + **tag** the release commit;
1. build + sign + verify `skywalking-nodejs-src-<v>.tgz{,.asc,.sha512}`;
1. push the tag (**only after** verify), add a `Prepare next release <next>-dev` commit, and
   **open the release PR**;
1. upload the RC to `dist/dev/skywalking/node-js/<v>/`;
1. print the **[VOTE] email** (with the real tag, commit, and sha512 — copy it for step 2).

> Release notes come from the auto-generated [GitHub Release](https://github.com/apache/skywalking-nodejs/releases)
> notes (`CHANGELOG.md` is a stub). Draft them once the tag exists:
> `gh release create v<v> --draft --generate-notes --verify-tag --notes-start-tag v<prev>`

## 2. Call for vote — `dev@skywalking.apache.org`

Send the `[VOTE]` email the script printed (template below). Keep it open **>= 72 hours**; it
passes with **>= 3 binding +1** (PMC) and more +1 than -1.

```text
Subject: [VOTE] Release Apache SkyWalking NodeJS version $VERSION

Hi the SkyWalking Community:
This is a call for vote to release Apache SkyWalking NodeJS version $VERSION.

Release notes:

 * https://github.com/apache/skywalking-nodejs/releases/tag/v$VERSION

Release Candidate:

 * https://dist.apache.org/repos/dist/dev/skywalking/node-js/$VERSION
 * sha512 checksums
   - sha512xxxxyyyzzz skywalking-nodejs-src-x.x.x.tgz

Release Tag :

 * (Git Tag) v$VERSION

Release Commit Hash :

 * https://github.com/apache/skywalking-nodejs/tree/<Git Commit Hash>

Keys to verify the Release Candidate :

 * https://dist.apache.org/repos/dist/release/skywalking/KEYS

Guide to build the release from source :

 * https://github.com/apache/skywalking-nodejs/blob/v$VERSION/CONTRIBUTING.md#compiling-and-building

Voting will start now and will remain open for at least 72 hours.
A release passes with at least 3 binding +1 (PMC) votes and more +1 than -1.

[ ] +1 Release this package.
[ ] +0 No opinion.
[ ] -1 Do not release this package because....

Thanks.

[1] https://github.com/apache/skywalking-nodejs/blob/master/docs/How-to-release.md#vote-check
```

### Vote check

Before voting +1, verify (all PMC members and committers):

1. Features test.
1. All artifacts in the staging dir are published with `.asc` and `.sha512` files (no `.md5`).
1. The source package `skywalking-nodejs-src-$VERSION.tgz` is in
   `https://dist.apache.org/repos/dist/dev/skywalking/node-js/$VERSION` with its `.asc` + `.sha512`.
1. `LICENSE` and `NOTICE` are present in the source package.
1. `shasum -c skywalking-nodejs-src-$VERSION.tgz.sha512`.
1. `gpg --verify skywalking-nodejs-src-$VERSION.tgz.asc skywalking-nodejs-src-$VERSION.tgz`.
1. Build from the source package following the
   [build guide](../CONTRIBUTING.md#compiling-and-building).
1. License-header check via license-eye (`apache/skywalking-eyes`, as run by
   `.github/workflows/license.yaml`); style lint via `npm run lint`.

### Close the vote

After it passes, send the closing mail, listing the binding and non-binding voters:

```text
[RESULT][VOTE] Release Apache SkyWalking NodeJS version $VERSION

72+ hours passed, we’ve got ($NUMBER) +1 bindings (and ... +1 non-bindings):

(list names)
+1 bindings:
xxx
...

+1 non-bindings:
xxx
...

Thank you for voting, I’ll continue the release process.
```

## 3. Finalize — `npm run release:finalize`

```shell
npm login                  # only if you will publish to npm (maintainer of skywalking-backend-js)
npm run release:finalize
```

It does, each irreversible step behind a `y/N` (npm auth is verified **up front**):

1. promotes the RC on svn: `dev/<v>` -> `release/<v>`, retiring the previous (strictly-older)
   release (it auto-archives to archive.apache.org);
1. publishes the **GitHub release** on `v<v>` (auto-notes), attaching the voted artifacts;
1. optionally publishes `skywalking-backend-js@<v>` to npm (skipped if already published).

Then finish the human steps it reminds you about:

1. **Merge the release PR** opened in step 1 (`master` returns to the next `-dev`; the `v<v>` tag
   stays pinned to the release commit).
1. **Website** ([apache/skywalking-website](https://github.com/apache/skywalking-website)): add the
   release event, bump the NodeJS Agent block in `data/releases.yml` and the docs pointer in
   `data/docs.yml` (see a prior [PR](https://github.com/apache/skywalking-website/pull/190)).
1. **[ANNOUNCE] email** from your `@apache.org` address to `dev@skywalking.apache.org` and
   `announce@apache.org`:

```text
Subject: [ANNOUNCEMENT] Apache SkyWalking NodeJS $VERSION Released

Hi the SkyWalking Community

On behalf of the SkyWalking Team, I’m glad to announce that SkyWalking NodeJS $VERSION is now released.

SkyWalking NodeJS: The NodeJS Agent for Apache SkyWalking, which provides the native tracing abilities for NodeJS backend project.

SkyWalking: APM (application performance monitor) tool for distributed systems, especially designed for microservices, cloud native and container-based (Docker, Kubernetes, Mesos) architectures.

Download Links: http://skywalking.apache.org/downloads/

Release Notes : https://github.com/apache/skywalking-nodejs/releases/tag/v$VERSION

Website: http://skywalking.apache.org/

SkyWalking NodeJS Resources:
- Issue: https://github.com/apache/skywalking/issues
- Mailing list: dev@skywalking.apache.org
- Documents: https://github.com/apache/skywalking-nodejs/blob/v$VERSION/README.md

The Apache SkyWalking Team
```

## Manual fallback

The scripts implement the standard ASF steps and are heavily commented; if you must run a step by
hand, read [`scripts/release.sh`](../scripts/release.sh) and
[`scripts/release-finalize.sh`](../scripts/release-finalize.sh). The essentials: clone with
`--recurse-submodules`; `npm version <v> --no-git-tag-version` to strip `-dev`; `npm install`;
commit; tag locally; `npm run release-src` to build + sign; verify the tarball + signature;
**then** push the tag; `svn` the three artifacts to `dist/dev/.../node-js/<v>/`; after the vote
`svn mv` dev -> release; publish the GitHub release; `npm run build && npm publish`.
