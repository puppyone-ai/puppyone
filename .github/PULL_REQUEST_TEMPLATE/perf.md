## Performance Problem Statement
- What is slow/expensive? Where does it manifest (endpoint, page, job)?
- Current baseline metrics (P50/P95 latency, throughput, CPU/mem, cost, etc.)

## Bottleneck Analysis
- Evidence: profiles, traces, logs, flame graphs (attach links/screenshots)
- Root causes and constraints

## Optimization Strategy
- Key changes and trade-offs
- Why this approach vs alternatives
- Data structures/algorithms/caching/IO changes

## Code Changes Summary
- Files/modules touched and nature of changes

## Before/After Metrics
- Baseline (methodology, sample size, environment)
- Results (same methodology) with numbers and % delta
- Impact on resource usage (CPU, memory, IO, network, cost)

## Risk & Guardrails
- Functional correctness risks
- Degradation risks under load
- Feature flags, safe rollout, and rollback plan

## Test Plan
- Unit/benchmark/micro-benchmark tests
- Load/stress tests (parameters, datasets)
- Realistic end-to-end validation

## Monitoring & Alerting
- Dashboards, SLOs/SLA, error budgets
- Alerts and thresholds

## Related Issues / Links
- Addresses #

## Checklist
- [ ] Metrics baselined and reproducible methodology documented
- [ ] Benchmarks added or updated
- [ ] Load test executed and results attached
- [ ] Monitoring/alerts updated to catch regressions
