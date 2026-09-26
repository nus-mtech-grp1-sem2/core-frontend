// A stand-in for the two Cognito calls the event service makes (ListUsers, AdminGetUser), so the
// team invitation flow can run without AWS credentials. It speaks the AWS JSON 1.1 protocol the
// SDK uses, and knows only the users it is given in FAKE_COGNITO_USERS:
//   [{ "sub": "...", "email": "...", "name": "..." }]
// It is started inside a container next to the backend (see support/fake-cognito.ts). Plain
// Node, no dependencies, so it runs in the backend's own image.
import { createServer } from 'node:http';

const users = JSON.parse(process.env.FAKE_COGNITO_USERS ?? '[]');
const port = Number(process.env.PORT ?? 9229);
const calls = [];
let failing = false;

const attributes = (user) => [
  { Name: 'sub', Value: user.sub },
  { Name: 'email', Value: user.email },
  { Name: 'email_verified', Value: 'true' },
  { Name: 'name', Value: user.name },
];

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/x-amz-json-1.1' });
  res.end(JSON.stringify(body));
}

/** ListUsers filters are `email = "a@b.c"`, with quotes inside the value escaped by a backslash. */
function emailFilter(filter) {
  const match = /^email\s*=\s*"((?:[^"\\]|\\.)*)"$/.exec(filter ?? '');
  return match ? match[1].replace(/\\(.)/g, '$1') : null;
}

const handlers = {
  ListUsers(input) {
    const email = emailFilter(input.Filter);
    const matching = users.filter((user) => email === null || user.email === email);
    return {
      Users: matching.slice(0, input.Limit ?? 60).map((user) => ({
        Username: user.sub,
        Attributes: attributes(user),
        UserStatus: 'CONFIRMED',
        Enabled: true,
      })),
    };
  },
  AdminGetUser(input) {
    const user = users.find((candidate) => candidate.sub === input.Username);
    if (!user) return { error: 'UserNotFoundException', message: 'User does not exist.' };
    return {
      Username: user.sub,
      UserAttributes: attributes(user),
      UserStatus: 'CONFIRMED',
      Enabled: true,
    };
  },
};

createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    // Control surface for the tests: what was called, and a switch to make Cognito "unavailable".
    if (req.method === 'GET' && req.url === '/__calls') return reply(res, 200, { calls });
    if (req.method === 'POST' && req.url === '/__failing') {
      failing = JSON.parse(Buffer.concat(chunks).toString() || '{}').failing === true;
      return reply(res, 200, { failing });
    }

    const operation = String(req.headers['x-amz-target'] ?? '')
      .split('.')
      .pop();
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    calls.push({ operation, input });
    if (failing)
      return reply(res, 500, { __type: 'InternalErrorException', message: 'unavailable' });
    const handler = handlers[operation];
    if (!handler)
      return reply(res, 400, { __type: 'InvalidParameterException', message: operation });
    const result = handler(input);
    if (result.error) return reply(res, 400, { __type: result.error, message: result.message });
    return reply(res, 200, result);
  });
}).listen(port, '0.0.0.0', () => console.log(`fake cognito on :${port}`));
