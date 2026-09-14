---
name: model-selection
description:
  Which OpenCode Go model each agent uses, with cost/quota and benchmark metrics
  behind the choice. Use when adding or retuning an agent, or when a new model
  ships and tiers may need revisiting.
---

# Model Selection

Single source of truth for `opencode-go/*` model choices in this harness. Update
this file when models change, then update the agent frontmatter and
`opencode.jsonc`.

## Current assignments

| Role                       | Model                        | Why                                                            |
| -------------------------- | ---------------------------- | -------------------------------------------------------------- |
| orchestrator               | `opencode-go/glm-5.2`        | Highest call volume; needs the $60/mo tier's $12 per 5h budget |
| planner                    | `opencode-go/glm-5.2`        | High-value output, moderate volume                             |
| coder                      | `opencode-go/kimi-k2.7-code` | Code-specialized, no cache-write fee, cheaper/req than glm-5.2 |
| tester                     | `opencode-go/glm-5.3-flash`  | High volume; ~$0.0019/req thanks to $0.03 cache read           |
| reviewer                   | `opencode-go/glm-5.3`        | Low volume, judgment-heavy; best agentic/security per token    |
| security                   | `opencode-go/glm-5.3`        | Same, plus strongest CyberGym / AutomationBench                |
| scribe                     | `opencode-go/glm-5.3-flash`  | Cheap, bounded editing                                         |
| small_model (titles, etc.) | `opencode-go/glm-5.3-flash`  | Cheapest model that is good enough for lightweight tasks       |

## How Go limits work

- Limits are monthly dollar amounts. Per model: **5h = 20%, week = 50%, month =
  100%**. A $60 model gets **$12 per 5h**; a $15 model only **$3**.
- Agent traffic is **cache-read dominated** (~90% of tokens), so cache-read
  price is the dominant cost term, not input/output price.
- $60/mo is the safe tier for high-call-count roles; $15/mo is for low-volume
  judgment roles where a $3 burst cap is unlikely to bite.
- Watch for **peak/off-peak** pricing (DeepSeek) and **promo cliffs** (DeepSeek
  V4.1 Flash is 4x→$60 only until 2026-09-20, then back to $15).
- **Privacy:** `muse-spark-*-contributor` trains on prompts/completions. Do not
  use it for this repository.

### Reference metrics (Go, Sep 2026)

| Model                 | In / cache / out (per 1M) | Monthly | Est. req/mo |
| --------------------- | ------------------------- | ------- | ----------- |
| `glm-5.2`             | $1.40 / $0.26 / $4.40     | $60     | 4,300       |
| `glm-5.3`             | $1.40 / $0.26 / $4.40     | $15     | 1,080       |
| `glm-5.3-flash`       | $0.15 / $0.03 / $0.50     | $60     | 31,580      |
| `kimi-k2.7-code`      | $0.95 / $0.19 / $4.00     | $60     | 6,750       |
| `kimi-k3`             | $3.00 / $0.30 / $15.00    | $15     | 490         |
| `deepseek-v4-pro`     | $0.66 / $0.022 / $1.98    | $15     | 5,200       |
| `deepseek-v4.1-flash` | $0.15 / $0.003 / $0.60    | $60→$15 | 32,500      |
| `qwen3.8-max`         | $2.00 / $0.25 / $6.00     | $15     | 810         |

## GLM-5.3 vs Kimi K3 (both $15/mo)

| Metric              | GLM-5.3           | Kimi K3                  |
| ------------------- | ----------------- | ------------------------ |
| In / cache / out    | $1.40/$0.26/$4.40 | $3.00/$0.30/$15.00       |
| Est. req/mo         | 1,080             | 490                      |
| Input modalities    | text              | text + image             |
| SWE-bench Verified  | 94.2              | 93.8                     |
| Terminal-Bench 2.1  | 86.5–88.2         | 80.9–88.3                |
| Terminal-Bench 3.0  | **28.3**          | 17.4                     |
| DeepSWE v1.1        | 66.9              | 67.5                     |
| SWE-Marathon v1.1   | 42.5              | **48.1**                 |
| CyberGym            | **84.5**          | 80.0                     |
| AutomationBench     | **48.2**          | 46.7                     |
| Toolathlon Verified | 73.0              | **76.5**                 |
| GDPval-AA v2 (Elo)  | **1,769**         | 1,682                    |
| Speed               | moderate          | slowest (~44 min/ticket) |

**Pick GLM-5.3** for review/security: cheaper per token, ~2x request headroom,
stronger on the agentic/security benchmarks that matter here, and much faster.
Kimi K3 only for long-horizon queued work and image input.

## DeepSeek V4.1 Flash vs GLM-5.3-Flash

| Metric                | DeepSeek V4.1 Flash            | GLM-5.3-Flash         |
| --------------------- | ------------------------------ | --------------------- |
| In / cache / out      | $0.15 / $0.003 / $0.60         | $0.15 / $0.03 / $0.50 |
| Monthly limit         | $60 → $15 after Sep 20         | $60 stable            |
| Est. req/mo           | 32,500 ($15) / 130,000 (promo) | 31,580                |
| Params                | 552B (A8/A16)                  | 320B (A18)            |
| Terminal-Bench 2.1    | **90.6**                       | 84.3                  |
| DeepSWE v1.1          | ~59                            | **63.4**              |
| AA Intelligence Index | 40                             | **57**                |
| Cost per AA task      | $0.27                          | **$0.045**            |
| Token efficiency      | poor (burns output)            | normal                |
| Hallucination         | high                           | —                     |

**Pick GLM-5.3-Flash** for high-volume/cheap roles. On Go's estimated token mix
DeepSeek looks ~4x cheaper per request, but on real tasks it emits far more
output tokens, so Artificial Analysis puts it at ~6x the cost per task and 17
points lower on the Intelligence Index. DeepSeek also reverts to $15 on Sep 20.

## Re-evaluation procedure

1. `opencode models opencode-go` — confirm available model IDs.
2. Fetch <https://opencode.ai/docs/go/> — current limits and per-request
   estimates.
3. Estimate cost per request from the **cache-read** price (dominant term).
4. Check the **5h cap**, not just the monthly limit.
5. Use stable $60/mo models for high-volume roles; $15/mo for low-volume
   judgment roles.
6. Verify benchmark numbers against independent sources; harness/scaffold
   differences swing scores by >15 points. Treat vendor tables as directional.
7. Check privacy terms and promo/peak pricing.
8. Update this file, the agent frontmatter, and `opencode.jsonc`, then verify
   with `opencode debug agent <name>`.

## Sources

- OpenCode Go limits: <https://opencode.ai/docs/go/>
- GLM-5.3 benchmarks: <https://glm5.app/blog/glm-5-3-benchmarks>
- GLM-5.3 vs Kimi K3 (independent):
  <https://friendli.ai/blog/kimi-k3-glm-5.3-coding-agent-benchmark>
- Kimi K3 speed/hallucination:
  <https://www.superconductor.com/blog/kimi-k3-benchmark>,
  <https://kili-technology.com/blog/kimi-k3s-benchmarks-and-hallucinations----what-that-tells-us-about-ai-evaluation>
- GLM-5.3-Flash: <https://z.ai/blog/glm-5.3-flash>
- DeepSeek V4.1 Flash:
  <https://www.heise.de/en/news/DeepSeek-V4-1-Flash-More-performance-than-V4-Pro-at-lower-prices-11450079.html>
