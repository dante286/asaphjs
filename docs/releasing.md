# Releasing

How a version of Asaph becomes a published image. For running one, see
[Self-hosting](self-hosting.md).

## Cutting a release

`package.json`'s version is hand-maintained, so a release is a version bump merged to main,
then a tag on that commit:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`release.yml` guards the tag rather than re-running the suite on a commit that already
passed: the tag must be `v*`, its version must match `package.json`, the commit must be an
ancestor of `main`, and `ci-required` must have concluded successfully for that exact SHA. It
then builds, pushes, and cuts a GitHub Release whose notes are generated from the merge
commits since the previous tag. `workflow_dispatch` against a tag re-publishes it.

The GHCR package is created **private** on the first publish and has to be made public by
hand, in the package's settings on GitHub. That's a one-time UI action, not something a
workflow can do for you.

The tags a release publishes, and why there is no bare major tag, are under
[Running the published image](self-hosting.md#running-the-published-image).

## Architectures

`linux/amd64` only. Building arm64 would mean QEMU, and the emulated leg is the whole
Turbopack compile rather than just a native dependency download — five to ten times slower,
so twenty to forty minutes added to every release for demand nobody has expressed.
(`package-lock.json` lists `@img/sharp-linuxmusl-arm64`, but that isn't evidence of any: npm
records every platform's optional dependency in lockfile v3, and it lists ppc64, riscv64 and
s390x too.) If arm64 is wanted, the right shape is a matrix of native `ubuntu-24.04` and
`ubuntu-24.04-arm` runners merged by digest, not QEMU.
