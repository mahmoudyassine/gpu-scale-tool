# Regression fixtures

Reference projects used to check that a release did not silently move a number.
They are **readable links**, so they are diffable, editable and cannot rot into
an opaque blob the way a compressed payload does.

To check a release, open each link in the studio before and after the change and
compare the verdict bar, the fleet total, and each pool's tensor-parallel width,
replica count and memory percentage. Anything that moves without a line in the
changelog explaining it is a regression.

| Fixture | What it exercises |
|---|---|
| `reference-project.txt` | Four use cases in three pools: pooling of two cards onto one deployment, a cross-node TP16 group, MIG-shared GPUs for supporting models, a P95 miss, and the prefix-cache recommendation. This is the project every figure in the manual was captured from. |
