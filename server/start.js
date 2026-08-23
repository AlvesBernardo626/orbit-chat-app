const { startServer } = require('./index');
const { DB_FILE } = require('./paths');
const { PORT } = require('../shared/constants');

const port = process.env.PORT ? Number(process.env.PORT) : PORT;
const host = process.env.HOST || '0.0.0.0';

startServer(DB_FILE, { port, host })
  .then(() => {
    console.log(`Servidor Orbit rodando em http://${host}:${port}`);
    console.log(`Banco de dados: ${DB_FILE}`);
  })
  .catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Já existe um servidor rodando na porta ${port}.`);
    } else {
      console.error('Falha ao iniciar o servidor:', err);
    }
    process.exit(1);
  });
