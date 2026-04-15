module.exports = {
  apps: [
    {
      name: 'drviaje-erp',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=DB --local --persist-to .wrangler/state --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
