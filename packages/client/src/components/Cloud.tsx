import { Link } from 'react-router-dom';
import { Cloud, Github, Gitlab, Slack, Trello, Bot, Code2, PenTool, TestTube, Check } from 'lucide-react';
import styles from './Cloud.module.css';

const integrations = [
    { icon: Code2, label: 'Code Agents' },
    { icon: Bot, label: 'Review Agents' },
    { icon: PenTool, label: 'Design Agents' },
    { icon: TestTube, label: 'Test Agents' },
    { icon: Github, label: 'GitHub' },
    { icon: Gitlab, label: 'GitLab' },
    { icon: Slack, label: 'Slack' },
    { icon: Trello, label: 'Jira' },
];

const teamFeatures = [
    'Up to 10 team members',
    'Unlimited boards & tickets',
    'AI agent integrations',
    'GitHub & GitLab sync',
    'Slack notifications',
    'Jira integration',
    'Email support',
    '5 GB storage',
];

const enterpriseFeatures = [
    'Unlimited team members',
    'Unlimited boards & tickets',
    'All AI agent integrations',
    'Advanced security & SSO',
    'Custom integrations',
    'Priority support',
    'Dedicated account manager',
    'Unlimited storage',
    'Audit logs',
    'SLA guarantees',
];

export function CloudPage() {
    return (
        <div className={styles.container}>
            <div className={styles.hero}>
                <div className={styles.heroContent}>
                    <div className={styles.heroIcon}>
                        <Cloud size={48} />
                    </div>
                    <h1 className={styles.title}>OpenBoard Cloud</h1>
                    <p className={styles.subtitle}>
                        Manage your development board in the cloud with powerful AI agent integrations. 
                        Collaborate with your team and automate your workflow with code, review, design, 
                        and test agents connected to your favorite tools.
                    </p>
                    <div className={styles.heroButtons}>
                        <Link to="/" className={styles.primaryBtn}>
                            Get Started
                        </Link>
                    </div>
                </div>
            </div>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Agent Integrations</h2>
                <p className={styles.sectionDesc}>
                    Supercharge your workflow with AI agents that work alongside your team
                </p>
                <div className={styles.featureGrid}>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>
                            <Code2 size={24} />
                        </div>
                        <h3>Code Agents</h3>
                        <p>AI-powered coding agents that pick up tasks, write code, and submit pull requests automatically.</p>
                    </div>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>
                            <Bot size={24} />
                        </div>
                        <h3>Review Agents</h3>
                        <p>Automated code review agents that analyze changes, suggest improvements, and ensure quality.</p>
                    </div>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>
                            <PenTool size={24} />
                        </div>
                        <h3>Design Agents</h3>
                        <p>AI design agents that create mockups, generate assets, and maintain design consistency.</p>
                    </div>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>
                            <TestTube size={24} />
                        </div>
                        <h3>Test Agents</h3>
                        <p>Automated testing agents that write and run tests to ensure your code works correctly.</p>
                    </div>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Tool Integrations</h2>
                <p className={styles.sectionDesc}>
                    Connect OpenBoard with the tools you already use
                </p>
                <div className={styles.integrationGrid}>
                    {integrations.map((item) => (
                        <div key={item.label} className={styles.integrationItem}>
                            <item.icon size={20} />
                            <span>{item.label}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Pricing Plans</h2>
                <p className={styles.sectionDesc}>
                    Choose the plan that fits your team's needs
                </p>
                <div className={styles.pricingGrid}>
                    <div className={styles.pricingCard}>
                        <div className={styles.pricingHeader}>
                            <h3>Team Plan</h3>
                            <div className={styles.price}>
                                <span className={styles.currency}>$</span>
                                <span className={styles.amount}>19</span>
                                <span className={styles.period}>/user/mo</span>
                            </div>
                            <p className={styles.pricingDesc}>Perfect for small to medium teams</p>
                        </div>
                        <ul className={styles.featureList}>
                            {teamFeatures.map((feature) => (
                                <li key={feature}>
                                    <Check size={16} className={styles.checkIcon} />
                                    {feature}
                                </li>
                            ))}
                        </ul>
                        <Link to="/" className={styles.planBtn}>
                            Get Started
                        </Link>
                    </div>

                    <div className={`${styles.pricingCard} ${styles.enterpriseCard}`}>
                        <div className={styles.pricingHeader}>
                            <h3>Enterprise Plan</h3>
                            <div className={styles.price}>
                                <span className={styles.currency}>$</span>
                                <span className={styles.amount}>49</span>
                                <span className={styles.period}>/user/mo</span>
                            </div>
                            <p className={styles.pricingDesc}>For large organizations with advanced needs</p>
                        </div>
                        <ul className={styles.featureList}>
                            {enterpriseFeatures.map((feature) => (
                                <li key={feature}>
                                    <Check size={16} className={styles.checkIcon} />
                                    {feature}
                                </li>
                            ))}
                        </ul>
                        <Link to="/" className={styles.planBtn}>
                            Contact Sales
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}
