# Fit eval

Does "this line of your record answers that requirement" agree with a person's judgment?
128 hand-labeled pairs (63 that answer, the rest that don't, many of
them sharing words without answering). Each model's cut-off is picked on half the pairs and
scored on the other 64, so these numbers are out of sample. Ran in 1s.

| Matcher                           | Precision | Recall |   F1 | Accuracy | Notes                       |
| --------------------------------- | --------: | -----: | ---: | -------: | --------------------------- |
| Shared words (keyword)            |       83% |    15% | 0.25 |      53% | AUC 0.58                    |
| all-MiniLM-L6-v2 (cut-off 0.33)   |       73% |    56% | 0.63 |      66% | AUC 0.75, 1.3 ms a sentence |
| all-MiniLM-L6-v2 + keyword        |       73% |    56% | 0.63 |      66% | answered if either says so  |
| bge-small-en-v1.5 (cut-off 0.605) |       74% |    76% | 0.75 |      73% | AUC 0.83, 2.3 ms a sentence |
| bge-small-en-v1.5 + keyword       |       74% |    76% | 0.75 |      73% | answered if either says so  |

Precision: of the requirements it says you answer, how many you do. Recall: of the ones you
do, how many it finds. coldopen's fit uses whichever of the two reads closer, with the
cut-off above (`FIT_SEMANTIC=on`); without it, fit is shared words alone.

## Where the combined matcher (bge-small-en-v1.5) still disagrees

|             | Record                                                                 | Requirement                                                                            | Similarity |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------: |
| missed      | Built a Fastify and Postgres API serving 2M requests a day             | Experience building and operating backend services in production                       |       0.60 |
| false match | Built a Fastify and Postgres API serving 2M requests a day             | Experience with Postgres query planner internals and contributing to the Postgres core |       0.64 |
| false match | AWS Solutions Architect certified                                      | Architect our frontend design system                                                   |       0.63 |
| false match | AWS Solutions Architect certified                                      | Solutions engineering experience in a pre-sales role with quota attainment             |       0.61 |
| false match | Explains Kubernetes to customers in workshops                          | Run Kubernetes clusters in production                                                  |       0.76 |
| false match | Explains Kubernetes to customers in workshops                          | Write Kubernetes operators in Go                                                       |       0.65 |
| false match | Wrote React and TypeScript dashboards used by 300 customers            | Own our customer success dashboards and churn reporting                                |       0.67 |
| missed      | Closed $1.2M in new ARR in my first year as an AE                      | Track record of exceeding quota in a closing role                                      |       0.54 |
| missed      | Closed $1.2M in new ARR in my first year as an AE                      | Experience closing new business with mid-market or enterprise accounts                 |       0.59 |
| false match | Booked 40 meetings a month as an SDR through cold email and calls      | Experience booking travel and managing executive calendars                             |       0.63 |
| missed      | Built Clay and HubSpot workflows that enrich and route 5k leads a week | Experience as a GTM engineer or in revenue operations                                  |       0.51 |
| missed      | Ran a 200-run chaos test with zero double refunds                      | Experience building reliable, fault-tolerant systems                                   |       0.56 |
| missed      | Learns a new codebase and ships in week one                            | Thrive in ambiguous environments and get productive fast                               |       0.58 |
| missed      | Led a team of 6 engineers through a platform rewrite                   | People leadership experience                                                           |       0.57 |
| false match | Led a team of 6 engineers through a platform rewrite                   | Experience as an individual contributor writing C++ game engines                       |       0.62 |
| missed      | Set up CI/CD and Terraform for a 40-service platform                   | DevOps or platform engineering background                                              |       0.59 |
| false match | Talked to 50 customers to scope our v1 roadmap                         | Experience as a customer support agent handling 50 tickets a day                       |       0.68 |

Regenerate: `node evals/fit/run.ts`. Labeled set: [pairs.ts](pairs.ts).
