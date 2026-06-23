/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
    outputFileTracingIncludes: {
      '/api/students/parse-import': ['./node_modules/pdfjs-dist/**/*'],
      '/api/exams/parse-pdf': ['./node_modules/pdfjs-dist/**/*'],
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
  },
}
module.exports = nextConfig
