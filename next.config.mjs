/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['ai', '@ai-sdk/openai'],
    // 部署适配：data/ 与 knowledge-base/ 是运行时 fs 读取的，
    // 必须显式声明打进产物，否则线上（EdgeOne）接口读不到文件
    outputFileTracingIncludes: {
      '/**': ['./data/**/*', './knowledge-base/**/*'],
    },
  },
};

export default nextConfig;
