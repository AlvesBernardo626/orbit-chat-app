const { startServer } = require('./index');
const { MONGODB_URI } = require('./paths');
const { PORT } = require('../shared/constants');

const port = process.env.PORT ? Number(process.env.PORT) : PORT;
const host = process.env.HOST || '0.0.0.0';

if (!MONGODB_URI) {
  console.error('MONGODB_URI não configurada. Defina essa variável de ambiente antes de iniciar o servidor.');
  process.exit(1);
}

startServer(MONGODB_URI, { port, host })
  .then(() => {
    console.log(`Servidor Orbit rodando em http://${host}:${port}`);
    console.log('Banco de dados: MongoDB Atlas');
  })
  .catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Já existe um servidor rodando na porta ${port}.`);
    } else {
      console.error('Falha ao iniciar o servidor:', err);
    }
    process.exit(1);
  });
