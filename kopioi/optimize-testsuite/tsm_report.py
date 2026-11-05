"""pytest plugin of the optimize-testsuite skill: records what one run collected, each test's outcome and the seconds
of each phase. testsuite.ps1 loads it with -p and names the output in TSM_OUT; nothing is written into the project."""

import hashlib
import json
import os
import platform

import pytest

PHASES = ("setup", "call", "teardown")


class Report:
    def __init__(self, out: str):
        self.out = out
        self.ids: list[str] = []
        self.cases: dict[str, dict] = {}

    def pytest_collection_finish(self, session):
        self.ids = sorted(item.nodeid for item in session.items)

    # Under pytest-xdist the controller collects nothing itself; each worker reports the ids it collected.
    @pytest.hookimpl(optionalhook=True)
    def pytest_xdist_node_collection_finished(self, node, ids):
        self.ids = sorted(ids)

    def pytest_runtest_logreport(self, report):
        case = self.cases.setdefault(report.nodeid, {"outcome": None, **dict.fromkeys(PHASES)})
        case[report.when] = round(report.duration, 4)
        if hasattr(report, "wasxfail"):
            if report.skipped:
                case["outcome"] = "xfailed"
            elif report.passed and report.when == "call":
                case["outcome"] = "xpassed"
        elif report.failed:
            # A failure outside the test body is pytest's "error", and it outranks a passed call.
            case["outcome"] = "failed" if report.when == "call" else "error"
        elif report.skipped:
            case["outcome"] = "skipped"
        elif report.when == "call" and case["outcome"] is None:
            case["outcome"] = "passed"

    def pytest_sessionfinish(self, session, exitstatus):
        if hasattr(session.config, "workerinput"):
            return
        counts = dict.fromkeys(("passed", "failed", "skipped", "xfailed", "xpassed", "error"), 0)
        for case in self.cases.values():
            if case["outcome"] is not None:
                counts[case["outcome"]] += 1
        phases = {p: round(sum(c[p] or 0 for c in self.cases.values()), 3) for p in PHASES}
        with open(self.out + ".cases.json", "w", encoding="utf-8") as f:
            json.dump([[nodeid, c["outcome"], *(c[p] for p in PHASES)] for nodeid, c in sorted(self.cases.items())], f)
        with open(self.out + ".plugin.json", "w", encoding="utf-8") as f:
            json.dump({"collected": len(self.ids),
                       "membership": hashlib.sha256("\n".join(self.ids).encode()).hexdigest(),
                       "counts": counts, "phases": phases, "runnerVersion": pytest.__version__,
                       "workers": str(workers) if (workers := getattr(session.config.option, "numprocesses", None)) else None,
                       "runtime": platform.python_version()}, f)


def pytest_configure(config):
    out = os.environ.get("TSM_OUT")
    if not out:
        raise pytest.UsageError("tsm_report is loaded by testsuite.ps1, which names the report in TSM_OUT")
    config.pluginmanager.register(Report(out), "tsm_report_recorder")
