# Dependency patches

## braces@3.0.3

Mitigates GHSA-vfj7-8cjw-p6xm by limiting parsed AST nesting to 100
levels across braces and parentheses before recursive walkers run. Excessive
nesting throws a SyntaxError, like the existing input-length validation.
Callers accepting untrusted patterns must handle validation errors.

The patch is installed through pnpm-workspace.yaml and applies to both
micromatch and chokidar dependency paths. Regression tests live in
tests/braces-security.test.cjs. Version-based audits may still flag 3.0.3;
this local mitigation does not constitute an upstream fixed release.

Remove the patch once an upstream fixed release is available and adopted.
Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
