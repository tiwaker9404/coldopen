# Résumé eval: proof a stranger understands

Model: built-in drafter (no model). 3 résumés, 17 drafted proof cards.

## Targets

| Target | Result | |
|---|---|---|
| has_action on every card | 17/17 (100%) | ✓ |
| has_result on every card | 17/17 (100%) | ✓ |
| has_where on every card | 17/17 (100%) | ✓ |
| keeps_before_after on the FDE résumé's 3 before/after bullets | 3/3 | ✓ |
| best picks chosen (at least 4 of 5) | 5/5 | ✓ |

## Every check, per résumé

| Résumé | Cards | has_action | has_result | keeps_before_after | has_where | numbers_from_resume | no_excluded_employer | within_limits | Rounds | Rebuilt | Dropped |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ashwin-fde.md | 8 | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 1 | 0 | 0 |
| priya-analyst.md | 4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 1 | 0 | 0 |
| marco-marketer.md | 5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 1 | 0 | 0 |
| **all** | 17 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | | | |

## ashwin-fde.md: drafted vs expected

Matched by meaning: same bullet, value equal or the same change, did and label sharing at least half their words. 6 of 16 rows matched; 8 picked.

| Bullet | Best | Expected | Drafted | Match |
|---|---|---|---|---|
| Current: HubSpot migration | ★ | **1.5M** HubSpot records moved to PostgreSQL, 100% consistent<br>Built an automated Python migration pipeline · Current FDE role | **1.5M** HubSpot records to PostgreSQL with 100% data consistency<br>Built an automated Python pipeline · Current FDE role | ✓ did 1.00, label 0.67 |
| Current: partner middleware |  | **50,000+** partner payloads a day, reconciled automatically<br>Built Python middleware syncing partner APIs · Current FDE role | **50,000+** daily payloads to synchronize internal backend systems<br>Built Python middleware · Current FDE role | ✗ label overlap 0.25 |
| Current: Docker on AWS |  | **60%** less manual configuration, zero-downtime deploys<br>Containerized client apps with Docker on AWS · Current FDE role | – | not picked |
| Rail: ETL | ★ | **6h → 45m** daily client data sync, from 6 hours to 45 minutes<br>Built containerized ETL with Docker and PostgreSQL · Rail Inc. | **6h → 45m** daily client data sync cycles, from 6 hours to 45 minutes<br>Built containerized ETL workflows using Docker and PostgreSQL · Rail Inc. | ✓ did 1.00, label 1.00 |
| Rail: analytics engine |  | **50GB** supply chain data a day, on the client's own servers<br>Deployed a Python analytics engine at an enterprise client · Rail Inc. | – | not picked |
| Rail: blockers |  | **12+** live deployment blockers resolved, ahead of SLA<br>Led scoping with enterprise engineering teams · Rail Inc. | – | not picked |
| Duke: middleware |  | **30%** faster deployments than planned<br>Built Node.js middleware unifying third-party API data · Duke consulting club | – | not picked |
| Duke: RBAC | ★ | **1,500+** user identities moved to RBAC, zero errors<br>Built a Python migration engine for access control · Duke consulting club | **1,500+** active user identities to a modernized Role-Based Access<br>Built a secure Python migration engine · Duke Advanced Degree Consulting Club | ✗ label overlap 0.33 |
| Deloitte: Oracle | ★ | **2.5M+** financial records moved off legacy Oracle<br>Migrated a Tier-1 bank's database to hybrid cloud · Deloitte | **2.5M+** historical financial records<br>Led a core operational database migration from legacy Oracle to a hybrid-cloud environment · Deloitte Touche Tohmatsu | ✓ did 0.67, label 0.67 |
| Deloitte: validation |  | **99%** ingestion accuracy, anomalies fixed automatically<br>Deployed validation microservices on client servers · Deloitte | – | not picked |
| ITC: Databricks |  | **150+** queries a second, no throttling<br>Built a real-time inventory engine on Databricks · ITC Infotech | – | not picked |
| ITC: runbooks |  | **5 → 3 days** customer onboarding, from 5 days to 3<br>Wrote deployment runbooks for regional teams · ITC Infotech | **5 → 3 days** infra onboarding, from 5 days to 3 days<br>Wrote technical runbooks and detailed deployment docs · ITC Infotech | ✓ did 0.60, label 0.67 |
| stmtflow |  | **100%** precision on 1,000 statements, 99.5% of tampering caught<br>Rebuilt a financial statement parser with balance checks · Statement Flow | – | not picked |
| Gateway: webhooks |  | **100,000+** webhook payloads a day at 99.9% uptime<br>Built a serverless gateway on AWS Lambda · B2B Integration Gateway | **100,000+** daily client webhook payloads with 99.9% uptime<br>Built a serverless B2B integration gateway using Python and AWS Lambda · Enterprise B2B Integration Gateway | ✓ did 1.00, label 1.00 |
| Gateway: errors |  | **85%** fewer database insertion errors<br>Added JSON schema checks at the network edge · B2B Integration Gateway | – | not picked |
| Gateway: onboarding | ★ | **3d → 4h** client onboarding, from 3 days to 4 hours<br>Automated provisioning with Terraform and GitHub Actions · B2B Integration Gateway | **3d → 4h** new client infra onboarding time, from 3 days to 4 hours<br>Structured modular Terraform templates and GitHub Actions CI/CD pipelines · Enterprise B2B Integration Gateway | ✓ did 0.60, label 1.00 |

## Cards that missed a check

None.
