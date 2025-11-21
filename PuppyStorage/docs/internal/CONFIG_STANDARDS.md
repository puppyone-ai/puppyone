# Configuration Standards

## Single Configuration File Policy

**Rule**: All Python tool configurations MUST be in `pyproject.toml` only.

**Prohibited files**:

- `pytest.ini`
- `setup.cfg`
- `.coveragerc`
- `mypy.ini`
- Any other tool-specific configuration files

## Rationale

### Problem Statement

Having multiple configuration files (e.g., both `pytest.ini` and `pyproject.toml`) creates:

- **Configuration drift**: Changes in one file but not the other
- **Maintenance burden**: Need to update multiple files for the same change
- **Confusion**: Unclear which file takes precedence
- **CI failures**: Silent config mismatches causing unexpected test failures

### Real Example (2025-10-22)

- Added `pgv` marker to `pyproject.toml`
- Forgot to add it to `pytest.ini` (which takes precedence)
- CI failed with "marker not found" error
- Required hotfix PR #948 to resolve

### Solution

- **Standard**: PEP 518 defines `pyproject.toml` as the single source for Python project metadata and tool configuration
- **Support**: All modern tools (pytest 6.0+, coverage 5.0+, mypy 0.900+, black 21.0+) fully support `pyproject.toml`
- **Benefits**:
  - Single file to maintain
  - No configuration precedence issues
  - Better visibility (all configs in one place)
  - Future-proof (Python community standard)

## Configuration Priority (for reference)

When multiple config files exist, pytest reads them in this order (first found wins):

1. `pytest.ini`
2. `pyproject.toml`
3. `tox.ini`
4. `setup.cfg`

**Our policy**: Only `pyproject.toml` exists, so no ambiguity.

## Current Configuration Structure

```toml
# pyproject.toml structure

[tool.pytest.ini_options]
# All pytest configuration

[tool.coverage.run]
[tool.coverage.report]
[tool.coverage.critical_paths]
# All coverage configuration

[tool.mypy]
[[tool.mypy.overrides]]
# All mypy configuration

[tool.black]
# All black configuration (if needed)
```

## Enforcement

- **Code review**: Reject PRs that add tool-specific config files
- **CI**: No automated check yet, relies on reviewer vigilance
- **Documentation**: This document + CONTRIBUTING.md

## Migration History

- **2025-10-22**: Removed `pytest.ini`, consolidated to `pyproject.toml` (PR #948)
- Reason: Config drift caused CI failure (#947 aftermath)

## References

- [PEP 518 – Specifying Minimum Build System Requirements](https://peps.python.org/pep-0518/)
- [pytest pyproject.toml documentation](https://docs.pytest.org/en/stable/reference/customize.html#pyproject-toml)
- [Coverage.py configuration](https://coverage.readthedocs.io/en/latest/config.html#configuration-reference)
