# pytest: finding and proving the cost

Reference for steps 2, 3 and 5 of optimize-testsuite. `<py>` is `<root>\.venv\Scripts\python.exe`, run from `<root>`.

## Where the time goes

`cases.json` rows are `[nodeid, outcome, setup, call, teardown]`. Totals per phase, per file and the slowest tests:

```powershell
$c = Get-Content <id>.cases.json -Raw | ConvertFrom-Json
'setup {0:n1}  call {1:n1}  teardown {2:n1}' -f ($c | % { $_[2] } | measure -Sum).Sum, ($c | % { $_[3] } | measure -Sum).Sum, ($c | % { $_[4] } | measure -Sum).Sum
$c | group { ($_[0] -split '::')[0] } | % { [pscustomobject]@{ file = $_.Name; n = $_.Count; s = [math]::Round(($_.Group | % { $_[2] + $_[3] + $_[4] } | measure -Sum).Sum, 1) } } | sort s -Descending | select -First 10
$c | sort { $_[2] + $_[3] + $_[4] } -Descending | select -First 20 | % { '{0,6:n2}  {1}' -f ($_[2] + $_[3] + $_[4]), $_[0] }
```

A flat list with a median setup of a few hundredths of a second means overhead times N: look at what every test's fixture does
(app start, migrations, key derivation, client start), not at single tests.

## The profiler trap

cProfile charges the time of a generator fixture to the frames that span its `yield`, and sees only the main thread. In
one project it showed 20 s of teardown where the phase durations showed 1 s. Trust the phase seconds in `cases.json`, then time
the suspect alone in a ten-line script (create the app, start the client, log in, one request: each on its own).

## Measuring a gain with the project untouched

- **Outside plugin.** Put the shortcut in a module outside the repo and load it:
  `$env:PYTHONPATH = '<scratchpad>'; & <py> -m pytest -q -p my_shortcut`. The module patches what the change would patch (for
  example replaces a start function with one that copies a prepared database) and the run shows the saving before any approval.
  Tests that fail under the prototype show which ones need the real path.
- **Process split** estimates parallel gain without installing anything: split the test files over N processes
  (`Start-Process` per group, wait for all) and take the wall time. It also shows whether tests share ports or files.
- **Order check.** A module with `pytest_collection_modifyitems` that reverses or shuffles `items` (seeded), loaded with `-p`,
  shows order dependence. Run it before and after a change that touches fixtures.

## Hangs

`ts measure` runs with `faulthandler_timeout=45` and kills the process tree at its own timeout, so `<id>.log` holds the stack of
every thread at the moment a test sat for 45 s. A thread standing in application code under an event loop frame is spinning, not
waiting. The venv launcher starts a second `python.exe`; a kill by hand needs `taskkill /PID <pid> /T /F`.

Faster setup exposes races that were always there: a busy loop in a job-draining function (an
`await gather(...)` over tasks that had all ended never yields) became 2 hangs in 5 runs, first on the fourth; in
another project xdist exposed three tests reading state a background loop had not written yet. That is why step 5 repeats.

## What has worked

| Pattern | Real path kept by | Gain |
|---|---|---|
| Cheap test-only cost (scrypt at production cost twice per test, lowered by a fixture) | a `real_hash` test checks production parameters | 160 s -> 56 s |
| Prepared state copied per test (a once-per-session migrated database, not 21 ms of migration each) | startup and migration modules marked `fresh_database` | 55 s -> 42 s |
| Routes built once per run (FastAPI 0.142 rebuilds every route per new app, 0.45 ms each, seen as slow calls; patch `_EffectiveRouteContext.from_api_route` in conftest) | login tests marked `fresh_routes` | 41.5 s -> 27.3 s |
| Server shutdown polls: `serve_forever(poll_interval=0.01)` in test servers (default waits up to 0.5 s) | n/a | per server stop |
| pytest-xdist `addopts = "-n auto"` when there is no setup to cut; one file runs with `-n 0` (workers start in about 10 s) | n/a | 138 s -> 27 s on 12 threads |

The route cost was found by timing one page alone (10 ms against 1 ms for the others) and profiling that request.

## What costs more than it gives

- One app object shared across tests: needs a production change and puts shared state between tests.
- Folding parametrized cases into one test: saves setup, loses the failing case's name.
- pytest-xdist: the largest gain left once setup is lean, and a dependency plus a CI change. It is its own decision for the user.
- Windows takes about 2 s to refuse a connection to a closed local port; tests that need a refused connection cost that there.
