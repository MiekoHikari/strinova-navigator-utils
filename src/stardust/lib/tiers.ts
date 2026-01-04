export enum Tiers {
	Tier4 = 'Tier 4',
	Tier3 = 'Tier 3',
	Tier2 = 'Tier 2',
	Tier1 = 'Tier 1',
	Tier0 = 'Tier 0'
}

export const TierRewards: Record<Tiers, number> = {
	[Tiers.Tier4]: 2800,
	[Tiers.Tier3]: 1800,
	[Tiers.Tier2]: 1200,
	[Tiers.Tier1]: 600,
	[Tiers.Tier0]: 0
};
