import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent instructions live in CLAUDE.md, so `next dev` shouldn't write an AGENTS.md.
  agentRules: false,
};

export default nextConfig;
