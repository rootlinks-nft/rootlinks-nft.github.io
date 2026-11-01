// Rootlinks site configuration. The ONLY place contract addresses live.
// Leave an address as "" until that contract is deployed and verified; the site then shows
// "Mint opens soon" and every prompt uses a clear placeholder instead of an address.
export const CONFIG = {
  chainId: 56, // BNB Smart Chain mainnet
  chainName: "BNB Smart Chain",

  // Rootlinks contracts (fill in on launch day, after BscScan/Sourcify verification)
  nft: "",          // RootlinksNFT
  distributor: "",  // RootlinksDistributor
  token: "",        // RootlinksToken (deployed by the Distributor; equals distributor.token())

  // External, already-deployed contracts
  agentIdRegistry: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F", // SPACE ID Agent ID (soulbound BEP-721)
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",

  // Public RPCs, tried in order (all send CORS headers)
  rpcs: [
    "https://bsc-mainnet.public.blastapi.io",
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc-rpc.publicnode.com",
  ],

  explorer: "https://bscscan.com",
  sourcify: "https://repo.sourcify.dev/contracts/full_match/56",
  siteUrl: "https://rootlinks-nft.github.io/",
  x: "https://x.com/rootlinks_nft",
  xHandle: "@rootlinks_nft",
  element: "https://element.market/",
  // Optional: public source repo link, shown in the Contracts section when set
  sourceRepo: "",
};

// Fixed by the contracts (constants), duplicated here only for display before deployment.
export const RULES = {
  maxSupply: 7777,
  caps: { free: 2200, invite: 1800, paid: 3377, reserve: 400 },
  priceWei: 3000000000000000n,       // 0.003 BNB
  invitePriceWei: 1500000000000000n, // 0.0015 BNB
  basePaidPerAgent: 5,
  maxBonusPaid: 5,
  maxInvitesPerTree: 2,
  mintHours: 72,
  refundPct: 80,
  royaltyPct: 5,
  rarity: [
    { key: "common", name: "Common", count: 5590, boost: "1×" },
    { key: "uncommon", name: "Uncommon", count: 1555, boost: "1.5×" },
    { key: "rare", name: "Rare", count: 555, boost: "3×" },
    { key: "legendary", name: "Legendary", count: 76, boost: "5×" },
    { key: "worldtree", name: "World Tree", count: 1, boost: "10×" },
  ],
  burn: { total: 50_000_000, weeks: 52 },
};

export const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
export const configured = (key) => isAddr(CONFIG[key]);
