# Release the Apache SkyWalking Node.js Agent

This guide explains how to release the Node.js Agent and how to check a release candidate. The
shell scripts
[`scripts/release.sh`](https://github.com/apache/skywalking-nodejs/blob/master/scripts/release.sh)
and
[`scripts/release-finalize.sh`](https://github.com/apache/skywalking-nodejs/blob/master/scripts/release-finalize.sh)
update versions, create tags, sign files, stage files in SVN, create the GitHub release, and publish
to npm. This guide covers the GPG key, vote, and announcement steps around those scripts.

`master` contains the current development version, such as `0.9.0-dev`. Do not edit
`package.json` by hand. `scripts/release.sh` removes `-dev` for the release commit and changes the
branch to the next `-dev` version in the same pull request.

## Publish the development documentation

The `Next` documentation should be registered in
[apache/skywalking-website](https://github.com/apache/skywalking-website) as soon as this docs
structure is merged. Do not wait for the next agent release. In the NodeJS Agent entry in
`data/docs.yml`, set `repoUrl` to this repository and add the link
`/docs/skywalking-nodejs/next/readme/`. The website build then imports `docs/README.md` and
`docs/menu.yml`.

## The release scripts

The release uses these three commands. The next sections explain each one.

```shell
bash scripts/release.sh --dry-run     # rehearse: full local build + sign + verify, NO push/svn/PR
bash scripts/release.sh               # cut the RC: tag, sign, svn-stage, open the release PR, print the [VOTE] email
# ... [VOTE] on dev@skywalking.apache.org for >= 72h, >= 3 binding +1 ...
bash scripts/release-finalize.sh      # promote svn dev -> release, publish the GitHub release, optional npm publish
```

You can also use `npm run release` and `npm run release:finalize`. With npm, use
`npm run release -- --dry-run` for the dry run.

Both scripts ask `y/N` before each remote change. Run them on one trusted, single-user host because
they read your SVN password. These settings are optional:

| Variable / flag | Effect | Default |
| :--- | :--- | :--- |
| `--dry-run` or `SW_RELEASE_DRY_RUN=1` | Run locally with no remote changes: no push, SVN upload, or pull request | off |
| `SW_RELEASE_REPO_URL` | Git repo to clone + push | `https://github.com/apache/skywalking-nodejs.git` |
| `SW_RELEASE_BRANCH` | Branch to cut from | `master` |
| `SW_RELEASE_GH_REPO` | `owner/repo` for the release PR / GitHub release | `apache/skywalking-nodejs` |
| `SW_GPG_KEY` | Pin the signing key (`release.sh` sets this from your `@apache.org` key automatically) | git/gpg default |
| `NPM_OTP` | npm one-time password for the `release-finalize.sh` publish | prompt |

> Before a real release, run
> `unset SW_RELEASE_REPO_URL SW_RELEASE_BRANCH SW_RELEASE_GH_REPO`. This removes test settings that
> could send release changes to the wrong repository.

## Prerequisites (one-time)

- **Apache GPG key** with an `@apache.org` user ID, added to the SkyWalking `KEYS` file:
  1. Upload the public key to a public key server.
  1. Register the fingerprint at [id.apache.org](https://id.apache.org/).
  1. **Append** (never overwrite) your key to the [SkyWalking KEYS](https://dist.apache.org/repos/dist/release/skywalking/KEYS)
     file — **PMC only**; ask a PMC member if needed.
- **Tools**: Node >= 20, plus `git`, `svn`, `gh`, `gpg`, `shasum`, `tar` (and `license-eye`,
  optional). Run `gh auth login`; for the npm publish, `npm login` as a maintainer of
  `skywalking-backend-js`.
- **Milestones**: close the current milestone and create the next one in
  [skywalking-nodejs](https://github.com/apache/skywalking-nodejs/milestones) and
  [skywalking](https://github.com/apache/skywalking/milestones).

## 1. Cut the release candidate — `bash scripts/release.sh`

```shell
bash scripts/release.sh --dry-run     # rehearse first: full local build + sign + verify, NO push/svn/PR
bash scripts/release.sh               # the real cut
```

`scripts/release.sh` performs these steps. It asks for approval before each remote change.

1. Check the GPG signer, required tools, and Node.js version.
1. Clone `master` with submodules and create a `prepare-release-<v>` branch.
1. Remove `-dev`, commit the release version, and tag the release commit.
1. Build, sign, and check `skywalking-nodejs-src-<v>.tgz{,.asc,.sha512}`.
1. Push the tag only after the checks pass. Add the next `-dev` commit and open the release pull
   request.
1. Upload the release candidate to `dist/dev/skywalking/node-js/<v>/`.
1. Print the `[VOTE]` email with the tag, commit, and SHA-512 value.

> Release notes come from the auto-generated [GitHub Release](https://github.com/apache/skywalking-nodejs/releases)
> notes (`CHANGELOG.md` is a stub). Draft them once the tag exists:
> `gh release create v<v> --draft --generate-notes --verify-tag --notes-start-tag v<prev>`

## 2. Call for vote — `dev@skywalking.apache.org`

Send the `[VOTE]` email printed by the script. The template is below. Keep the vote open for at
least 72 hours. It passes with at least three binding `+1` votes from PMC members and more `+1`
votes than `-1` votes.

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

 * docs/en/contribution/build-and-test.md (in the source package)

Voting will start now and will remain open for at least 72 hours.
A release passes with at least 3 binding +1 (PMC) votes and more +1 than -1.

[ ] +1 Release this package.
[ ] +0 No opinion.
[ ] -1 Do not release this package because....

Thanks.

[1] docs/en/contribution/release.md, "Vote check" section (in the source package)
```

### Vote check

Before voting `+1`, check the following items:

1. Test the release features.
1. Check that every file in the staging directory has `.asc` and `.sha512` files. Do not use
   `.md5`.
1. The source package `skywalking-nodejs-src-$VERSION.tgz` is in
   `https://dist.apache.org/repos/dist/dev/skywalking/node-js/$VERSION` with its `.asc` + `.sha512`.
1. `LICENSE` and `NOTICE` are present in the source package.
1. `shasum -c skywalking-nodejs-src-$VERSION.tgz.sha512`.
1. `gpg --verify skywalking-nodejs-src-$VERSION.tgz.asc skywalking-nodejs-src-$VERSION.tgz`.
1. Build from the source package following the
   [build and test guide](build-and-test.md).
1. Run the license header check with `apache/skywalking-eyes`, as configured in
   `.github/workflows/license.yaml`, and run `npm run lint`.

### Close the vote

After the vote passes, send the result email. List the binding and non-binding voters.

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

## 3. Finalize — `bash scripts/release-finalize.sh`

```shell
npm login                  # only if you will publish to npm (maintainer of skywalking-backend-js)
bash scripts/release-finalize.sh
```

The script checks npm access first and asks for approval before each remote change. It then:

1. Moves the release candidate in SVN from `dev/<v>` to `release/<v>` and archives the older
   release.
1. Publishes the GitHub release for `v<v>` and attaches the approved files.
1. Optionally publishes `skywalking-backend-js@<v>` to npm. It skips this when the version is
   already published.

Then complete these steps:

1. **Merge the release pull request** opened in step 1. `master` returns to the next `-dev`
   version, while the `v<v>` tag stays on the release commit.
1. **Update the website** in
   [apache/skywalking-website](https://github.com/apache/skywalking-website). Update the NodeJS Agent
   entries in `data/releases.yml` and `data/docs.yml`. Add the released documentation version and
   its commit. The one-time `Next` registration described above should already be present.
1. **[ANNOUNCE] email** from your `@apache.org` address to `dev@skywalking.apache.org` and
   `announce@apache.org`:

```text
Subject: [ANNOUNCEMENT] Apache SkyWalking NodeJS $VERSION Released

Hi the SkyWalking Community

On behalf of the SkyWalking Team, I’m glad to announce that Apache SkyWalking NodeJS $VERSION is now released.

SkyWalking NodeJS is the Node.js Agent for Apache SkyWalking. It provides native tracing for Node.js services.

Apache SkyWalking is an application performance monitoring system for distributed services.

Download Links: https://skywalking.apache.org/downloads/

Release Notes : https://github.com/apache/skywalking-nodejs/releases/tag/v$VERSION

Website: https://skywalking.apache.org/

SkyWalking NodeJS Resources:
- Issue: https://github.com/apache/skywalking/issues
- Mailing list: dev@skywalking.apache.org
- Documents: https://github.com/apache/skywalking-nodejs/blob/v$VERSION/docs/README.md

The Apache SkyWalking Team
```

## Manual fallback

The scripts follow the standard ASF release steps. Read
[`scripts/release.sh`](https://github.com/apache/skywalking-nodejs/blob/master/scripts/release.sh)
and
[`scripts/release-finalize.sh`](https://github.com/apache/skywalking-nodejs/blob/master/scripts/release-finalize.sh)
before running any step by hand. Clone with `--recurse-submodules`, remove `-dev` with
`npm version <v> --no-git-tag-version`, and run `npm install`. Commit and tag locally. Run
`npm run release-src`, then check the source file, signature, and checksum before pushing the tag.
Stage the three files in `dist/dev/.../node-js/<v>/`. After the vote, move the SVN directory from
`dev` to `release`, publish the GitHub release, and run `npm run build && npm publish`.
