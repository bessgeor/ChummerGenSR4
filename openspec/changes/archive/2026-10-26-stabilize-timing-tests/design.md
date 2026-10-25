# Design

## Decisions

- Wait on the event a test is about, not on a time: a stop is sent once the build (repair) or the process (host) has started, and a removal is checked once it is logged.
- Where a test is about a deadline, the time before the deadline starts is taken out of the measurement by a clock that stands still; the deadline itself still runs on real timers, so the test still proves that a hanging build is stopped at the deadline.
- A test whose failure could not be reproduced is not changed in what it checks; its assertion only reports the error it got.

## Fixture and live evidence

Only tests change; repeated runs of the suite are the evidence. No live run is needed and `bin/ChummerGenSR4.exe` is not touched.
