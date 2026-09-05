"""Parse every GitHub Actions workflow with a strict YAML parser.

    python scripts/check_workflows.py

Exists because a workflow GitHub cannot parse fails in a uniquely unhelpful way:
no job starts, nothing is annotated, and the run appears in the list named after
its file path (".github/workflows/ci.yml") instead of the workflow's `name:`.
There is no error message anywhere in the UI saying what is wrong.

The specific trap that motivated this: a plain YAML scalar may not contain ": "
(colon then space). So

    run: pip install --only-binary=:all: -r requirements.txt

is invalid — `:all:` is followed by a space — while the identical command inside
a block scalar is fine:

    run: |
      pip install --only-binary=:all: -r requirements.txt

Nothing about the command looks like YAML, which is what makes it easy to write
and hard to spot.

LIMITATION, stated because it matters: run from CI this cannot catch ci.yml
breaking *itself* — a file GitHub will not parse never runs the job that would
have checked it. That case still shows up as the path-named failure above. Run
from the pre-commit hook it catches everything, which is the point of wiring it
there as well.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"


def main() -> int:
    try:
        import yaml
    except ImportError:
        # Do not block a commit on a machine without PyYAML; CI still checks.
        print("check_workflows: PyYAML not installed, skipping", file=sys.stderr)
        return 0

    files = sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
    if not files:
        print(f"check_workflows: no workflows found in {WORKFLOWS}", file=sys.stderr)
        return 1

    failures = []
    for path in files:
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark else ""
            problem = getattr(e, "problem", str(e))
            failures.append(f"{path.relative_to(ROOT)}: {problem}{where}")
            continue
        if not isinstance(doc, dict) or "jobs" not in doc:
            failures.append(f"{path.relative_to(ROOT)}: parsed, but has no 'jobs' mapping")

    if failures:
        print("Workflow YAML is invalid:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print(
            "\nA workflow GitHub cannot parse starts no jobs and reports no error — "
            "the run is just named after the file path. Common cause: a plain scalar "
            'containing ": ". Use a block scalar (run: |).',
            file=sys.stderr,
        )
        return 1

    print(f"check_workflows: {len(files)} workflow(s) OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
