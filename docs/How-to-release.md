# Apache SkyWalking NodeJS Release Guide

This documentation guides the release manager to release the SkyWalking NodeJS in the Apache Way, and also helps people to check the release for voting.

## Automated release (recommended)

`master` carries the in-flight dev version (e.g. `0.9.0-dev`), like SkyWalking's `-SNAPSHOT` convention. Two scripts automate the rest. Run them on a single-user trusted host, with your Apache GPG key (an `@apache.org` uid, already in the [KEYS](https://dist.apache.org/repos/dist/release/skywalking/KEYS) file) configured and Node >= 20:

```shell
npm run release            # cut a release branch: strip -dev, commit + tag the release commit,
                           # build + sign the source release, verify it, push the tag, add a
                           # second commit bumping the branch to the next -dev, open the release PR,
                           # upload the RC to svn dev, and print the [VOTE] email
# ... after the vote passes (open >= 72h, >= 3 binding +1, more +1 than -1) ...
npm run release:finalize   # svn move dev -> release, publish the GitHub release, optionally publish to npm
# then merge the release PR opened by `npm run release` (master returns to -dev; the tag stays put).
```

You do **not** bump the version by hand — `npm run release` strips the `-dev` suffix for the release commit and bumps the branch to the next dev version in the same PR (master returns to `-dev` when the PR merges).

To rehearse the whole flow with **zero side effects** — a full local clone, strip, build, sign and verify, but **no** tag/branch push, **no** svn upload and **no** PR — run `npm run release -- --dry-run` (or `SW_RELEASE_DRY_RUN=1 npm run release`).

If you intend to publish to npm in `release:finalize`, run `npm login` first (you must be a maintainer of `skywalking-backend-js`). The script verifies npm auth **up front** — before the irreversible svn move — and auto-skips the npm step if that version is already published.

The rest of this guide is the reference those scripts implement, and the fallback for running a step by hand.

## Prerequisites

1. Close (if finished, or move to next milestone otherwise) all issues in the current milestone from [skywalking-nodejs](https://github.com/apache/skywalking-nodejs/milestones) and [skywalking](https://github.com/apache/skywalking/milestones), create a new milestone for the next release.
1. The version is managed by `npm run release` (it strips `-dev` for the release commit and bumps `master` to the next `-dev`); you do not edit `package.json` by hand. CHANGELOG.md is a stub — release notes are the auto-generated [GitHub Release](https://github.com/apache/skywalking-nodejs/releases) notes.


## Add your GPG public key to Apache svn

1. Upload your GPG public key to a public GPG site, such as [MIT's site](http://pgp.mit.edu:11371/).

1. Log in [id.apache.org](https://id.apache.org/) and submit your key fingerprint.

1. Add your GPG public key into [SkyWalking GPG KEYS](https://dist.apache.org/repos/dist/release/skywalking/KEYS) file, **you can do this only if you are a PMC member**.  You can ask a PMC member for help. **DO NOT override the existed `KEYS` file content, only append your key at the end of the file.**


## Build and sign the source code package

`npm run release` automates this. To do it by hand, mirror the script — strip `-dev`, build, and push the tag **only after** the build verifies (master carries `$VERSION-dev`):

```shell
export VERSION=<the release version, e.g. 0.9.0>     # bare semver

git clone --recurse-submodules git@github.com:apache/skywalking-nodejs && cd skywalking-nodejs
git checkout -b "prepare-release-$VERSION"
npm version "$VERSION" --no-git-tag-version          # strip -dev: package.json + lockfile -> $VERSION
npm install
git commit -am "Prepare release $VERSION"
git tag -a "v$VERSION" -m "Release Apache SkyWalking-NodeJS $VERSION"   # tag LOCALLY first

npm run release-src                                  # skywalking-nodejs-src-$VERSION.tgz{,.asc,.sha512}
# verify the tarball + signature, THEN push the tag (and branch, for the next-dev PR):
git push origin "v$VERSION" "prepare-release-$VERSION"
```

## Upload to Apache svn

```bash
svn co https://dist.apache.org/repos/dist/dev/skywalking/node-js/ release/skywalking/node-js
mkdir -p release/skywalking/node-js/"$VERSION"
cp skywalking-node-js/skywalking*.tgz release/skywalking/node-js/"$VERSION"
cp skywalking-node-js/skywalking*.tgz.asc release/skywalking/node-js/"$VERSION"
cp skywalking-node-js/skywalking*.tgz.sha512 release/skywalking/node-js/"$VERSION"

cd release/skywalking && svn add node-js/$VERSION && svn commit node-js -m "Draft Apache SkyWalking-NodeJS release $VERSION"
```

## Call for vote in dev@ mailing list

Call for vote in `dev@skywalking.apache.org`.

```text
Subject: [VOTE] Release Apache SkyWalking NodeJS version $VERSION

Content:

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

 * https://github.com/apache/skywalking-nodejs/blob/master/CONTRIBUTING.md#compiling-and-building

Voting will start now and will remain open for at least 72 hours, all PMC members are required to give their votes.

[ ] +1 Release this package.
[ ] +0 No opinion.
[ ] -1 Do not release this package because....

Thanks.

[1] https://github.com/apache/skywalking-nodejs/blob/master/docs/How-to-release.md#vote-check
```

## Vote Check

All PMC members and committers should check these before voting +1:

1. Features test.
1. All artifacts in staging repository are published with `.asc` and `.sha512` files.
1. Source codes and distribution packages (`skywalking-nodejs-src-$VERSION.tgz`)
are in `https://dist.apache.org/repos/dist/dev/skywalking/node-js/$VERSION` with `.asc`, `.sha512`.
1. `LICENSE` and `NOTICE` are in source codes and distribution package.
1. Check `shasum -c skywalking-nodejs-src-$VERSION.tgz.sha512`.
1. Check `gpg --verify skywalking-nodejs-src-$VERSION.tgz.asc skywalking-nodejs-src-$VERSION.tgz`.
1. Build distribution from source code package by following this [the build guide](#build-and-sign-the-source-code-package).
1. License-header check via license-eye (`apache/skywalking-eyes`, as run by `.github/workflows/license.yaml`); style lint via `npm run lint`.

Vote result should follow these:

1. PMC vote is +1 binding, all others is +1 no binding.

1. Within 72 hours, you get at least 3 (+1 binding), and have more +1 than -1. Vote pass.

1. **Send the closing vote mail to announce the result**.  When count the binding and no binding votes, please list the names of voters. An example like this:

   ```
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

## Publish release

1. Move source codes tar balls and distributions to `https://dist.apache.org/repos/dist/release/skywalking/`, **you can do this only if you are a PMC member**.

    ```shell
    svn mv https://dist.apache.org/repos/dist/dev/skywalking/node-js/"$VERSION" https://dist.apache.org/repos/dist/release/skywalking/node-js/"$VERSION"
    ```

1. Refer to the previous [PR](https://github.com/apache/skywalking-website/pull/190), update news and links on the website. There are several files need to modify.

1. Update [Github release page](https://github.com/apache/skywalking-nodejs/releases), follow the previous convention.

1. Publish to npmjs.com, this is optional for Apache releases, but we usually want to do this to let users use it conveniently.

  ```shell
  npm run build && npm pack && npm publish
  ```

**NOTE**: please double check before publishing to npmjs.com, it's difficult to unpublish and republish the module at the moment.

1. Send ANNOUNCE email to `dev@skywalking.apache.org` and `announce@apache.org`, the sender should use his/her Apache email account.

    ```
    Subject: [ANNOUNCEMENT] Apache SkyWalking NodeJS $VERSION Released

    Content:

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


