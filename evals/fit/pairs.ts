/**
 * The labeled set for the fit eval: a line of someone's record, a requirement from a job post,
 * and whether the line plainly answers it (1) or not (0). Hand-labeled. The requirements are
 * written the way real posts phrase them; the record lines the way people write their profiles.
 *
 * Built to be hard in both directions: answers that share no words with what they answer
 * ("Shipped LLM agents" / "large language model applications"), and lines that share words
 * with a requirement without answering it ("Explains Kubernetes to customers" / "Run
 * Kubernetes in production").
 */
export interface Pair {
  record: string
  requirement: string
  answers: 0 | 1
}

type Group = [record: string, yes: string[], no: string[]]

const GROUPS: Group[] = [
  [
    'Shipped LLM agents to production with evals and tracing',
    [
      'Experience deploying large language model applications to real users',
      'You have built and evaluated AI agents end to end',
      'Hands-on experience with prompt engineering, evaluation and observability for LLM systems',
      'Built production systems on top of GPT, Claude or open models',
    ],
    [
      'Experience training foundation models on large GPU clusters',
      'Deep background in classical computer vision',
      'Own our production database migrations',
      'Comfortable carrying a sales quota',
    ],
  ],
  [
    'Built a Fastify and Postgres API serving 2M requests a day',
    [
      'Strong backend engineering in Node.js or TypeScript',
      'Experience designing and scaling relational databases like PostgreSQL',
      'You have built high-throughput REST APIs',
      'Experience building and operating backend services in production',
    ],
    [
      'Native iOS development in Swift',
      'Experience with Postgres query planner internals and contributing to the Postgres core',
      'Lead a team of five or more engineers',
      'Design and run paid acquisition campaigns',
    ],
  ],
  [
    'Explains technical trade-offs to non-engineers',
    [
      'Ability to communicate complex technical concepts to non-technical stakeholders',
      'Comfortable translating engineering decisions for executives and customers',
      'Excellent written and verbal communication with business audiences',
    ],
    [
      'Experience building trading systems with microsecond latency',
      'Deep expertise in distributed consensus algorithms',
      'Strong engineering fundamentals in data structures and algorithms',
      'Write technical documentation for an open-source SDK',
    ],
  ],
  [
    'Turns messy customer data into working pipelines',
    [
      'Experience building ETL pipelines from customer data sources',
      'Comfortable integrating with customer systems and cleaning their data',
      'Experience with data integration, transformation and ingestion',
      'Build data connectors into customer warehouses',
    ],
    [
      'PhD in statistics or a related quantitative field',
      'Manage enterprise customer renewals and expansion',
      'Experience building consumer mobile apps',
    ],
  ],
  [
    'Embedded with 4 enterprise customers to deploy our platform onsite',
    [
      'Experience in a forward deployed, solutions or customer-facing engineering role',
      'Willingness to work directly with customers on their premises',
      'Have deployed software inside large enterprises',
      'Comfortable working side by side with customer engineering teams',
    ],
    [
      'Experience building our core platform’s storage layer',
      'Run payroll and benefits administration',
      'Five years of experience with Kubernetes operators',
    ],
  ],
  [
    'AWS Solutions Architect certified',
    [
      'Experience with AWS or another major cloud provider',
      'Cloud architecture experience (AWS, GCP or Azure)',
      'Familiarity with cloud infrastructure and services',
    ],
    [
      'Experience selling AWS Marketplace listings',
      'Architect our frontend design system',
      'Licensed architect with building design experience',
      'Solutions engineering experience in a pre-sales role with quota attainment',
    ],
  ],
  [
    'Explains Kubernetes to customers in workshops',
    ['Experience running technical workshops and trainings for customers'],
    [
      'Run Kubernetes clusters in production',
      'Deep hands-on experience operating Kubernetes at scale',
      'Write Kubernetes operators in Go',
    ],
  ],
  [
    'Wrote React and TypeScript dashboards used by 300 customers',
    [
      'Strong frontend skills in React',
      'Proficiency in TypeScript and modern web frameworks',
      'You have shipped customer-facing web applications',
      'Experience building data-heavy user interfaces',
    ],
    [
      'Experience with React Native mobile development and App Store releases',
      'Own our customer success dashboards and churn reporting',
      'Strong background in embedded C on microcontrollers',
    ],
  ],
  [
    'Closed $1.2M in new ARR in my first year as an AE',
    [
      'Track record of exceeding quota in a closing role',
      'Proven success in full-cycle B2B software sales',
      'Experience closing new business with mid-market or enterprise accounts',
    ],
    [
      'Build financial models for our annual recurring revenue forecasts',
      'Experience managing a team of account executives',
      'Strong engineering skills in Python',
      'Own our accounts payable and receivable processes',
    ],
  ],
  [
    'Booked 40 meetings a month as an SDR through cold email and calls',
    [
      'Experience in outbound prospecting',
      'Comfortable with high-volume cold outreach across email and phone',
      'Background in sales development or business development',
    ],
    [
      'Experience booking travel and managing executive calendars',
      'Own email deliverability infrastructure, DNS and SMTP',
      'Manage a book of existing customer accounts',
    ],
  ],
  [
    'Built Clay and HubSpot workflows that enrich and route 5k leads a week',
    [
      'Experience automating go-to-market workflows',
      'Hands-on with CRM systems and sales tooling',
      'Built lead enrichment, scoring or routing systems',
      'Experience as a GTM engineer or in revenue operations',
    ],
    [
      'Experience building a CRM product from scratch as a backend engineer',
      'Lead brand and creative for marketing campaigns',
      'Manage a team of 10 SDRs',
    ],
  ],
  [
    'Ran a 200-run chaos test with zero double refunds',
    [
      'Experience building reliable, fault-tolerant systems',
      'Care about correctness, idempotency and failure handling',
      'Experience testing distributed systems under failure',
    ],
    [
      'Experience processing customer refunds and chargebacks in a support role',
      'Strong product design sense and Figma skills',
      'Familiar with chaos engineering conferences and community building',
    ],
  ],
  [
    'Learns a new codebase and ships in week one',
    [
      'Able to ramp up quickly in unfamiliar codebases',
      'Bias to action and fast execution',
      'Thrive in ambiguous environments and get productive fast',
    ],
    [
      'Ten years of experience with our codebase’s language, Erlang',
      'Ship physical products through manufacturing',
      'Manage weekly release trains for a mobile app',
    ],
  ],
  [
    'Maintains an open-source Python library with 3k GitHub stars',
    [
      'Strong Python skills',
      'Open-source contributions are a plus',
      'Experience maintaining libraries used by other developers',
    ],
    [
      'Experience with GitHub Enterprise administration and SSO',
      'Grow our developer community on social media',
      'Experience with Python for financial accounting',
    ],
  ],
  [
    'Modeled warehouse data with dbt and Snowflake for finance',
    [
      'Experience with modern data stack tools like dbt and Snowflake',
      'Strong SQL and data modeling skills',
      'Build analytics models that business teams rely on',
    ],
    [
      'CPA with experience leading month-end close',
      'Operate physical warehouses and logistics',
      'Train machine learning models on tabular data',
    ],
  ],
  [
    'Led a team of 6 engineers through a platform rewrite',
    [
      'Experience managing or leading engineering teams',
      'Have led large technical migrations',
      'People leadership experience',
    ],
    [
      'Rewrite our marketing website copy',
      'Experience as an individual contributor writing C++ game engines',
      'Lead generation experience for sales teams',
    ],
  ],
  [
    'Built a Kafka pipeline processing 1B events a day',
    [
      'Experience with streaming systems such as Kafka or Kinesis',
      'Built data infrastructure at large scale',
      'Experience with high-volume event processing',
    ],
    [
      'Plan and run large in-person events and conferences',
      'Literary background, familiar with Kafka and modern fiction',
      'Experience as a data analyst building Tableau reports',
    ],
  ],
  [
    'Set up CI/CD and Terraform for a 40-service platform',
    [
      'Infrastructure as code experience, such as Terraform',
      'Experience building deployment pipelines',
      'DevOps or platform engineering background',
    ],
    [
      'Experience with platform partnerships and business development',
      'Design services for a hospitality platform',
      'Experience with Terraform Enterprise sales',
    ],
  ],
  [
    'Interned at a YC startup building their onboarding flow',
    [
      'Experience at an early-stage startup',
      'Experience building user onboarding or growth features',
    ],
    [
      'Ten or more years of experience as a staff engineer',
      'Experience running employee onboarding as an HR partner',
      'Managed a seed fund’s portfolio',
    ],
  ],
  [
    'Talked to 50 customers to scope our v1 roadmap',
    [
      'Experience doing customer discovery and user research',
      'Product sense and comfort talking to users',
      'Translate customer feedback into product requirements',
    ],
    [
      'Experience as a customer support agent handling 50 tickets a day',
      'Own our cloud cost roadmap and FinOps',
      'Strong background in computer graphics',
    ],
  ],
]

export const PAIRS: Pair[] = GROUPS.flatMap(([record, yes, no]) => [
  ...yes.map((requirement) => ({ record, requirement, answers: 1 as const })),
  ...no.map((requirement) => ({ record, requirement, answers: 0 as const })),
])
