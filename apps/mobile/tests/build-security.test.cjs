const test = require('node:test'),
  assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, verify } = require('node:crypto');
const fs = require('node:fs'),
  Module = require('node:module');
const { check } = require('../scripts/harden-build.cjs');

test('Expo56 actual plugin and command validators work with the patched Zod4 override', () => {
  const path = require('node:path');
  const base = path.resolve(__dirname, '../node_modules/@expo/cli/build/src/start/server');
  const { PluginSchema, DevToolsPluginOutputSchema } = require(path.join(base, 'DevToolsPlugin.schema.js'));
  const { createMCPDevToolsExtensionSchema } = require(
    path.join(base, 'createMCPDevToolsExtensionSchema.js'),
  );
  const plugin = PluginSchema.parse({
    packageName: 'local-security-check',
    packageRoot: '/local',
    cliExtensions: {
      description: 'Offline schema check',
      entryPoint: 'entry.js',
      commands: [
        {
          name: 'inspect',
          title: 'Inspect',
          environments: ['cli', 'mcp'],
          parameters: [
            { name: 'count', type: 'number' },
            { name: 'confirmed', type: 'confirm' },
            { name: 'label', type: 'text' },
          ],
        },
      ],
    },
  });
  const schema = createMCPDevToolsExtensionSchema(plugin);
  assert.deepEqual(schema.parse({ command: 'inspect', count: 2, confirmed: false, label: 'Safe' }), {
    command: 'inspect',
    count: 2,
    confirmed: false,
    label: 'Safe',
  });
  for (const input of [
    { command: 'unknown' },
    { command: 'inspect', count: '2' },
    { command: 'inspect', confirmed: 'true' },
    { command: 'inspect', extra: true },
  ])
    assert.equal(schema.safeParse(input).success, false);
  assert.deepEqual(DevToolsPluginOutputSchema.parse([{ type: 'text', text: 'Local only', level: 'info' }]), [
    { type: 'text', text: 'Local only', level: 'info' },
  ]);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'audio', url: 'invalid' }]).success, false);
});

test('all installed build-security backports match reviewed file fingerprints', () => {
  const result = check();
  assert.equal(result.patchedFilesVerified, 6);
  assert.equal(result.backportedAdvisories.length, 2);
});
test('braces rejects deep source patterns and ASTs without stack exhaustion while preserving ordinary globs', () => {
  const braces = require('braces');
  assert.deepEqual(braces.expand('src/{api,web}/file{1..3}.ts'), [
    'src/api/file1.ts',
    'src/api/file2.ts',
    'src/api/file3.ts',
    'src/web/file1.ts',
    'src/web/file2.ts',
    'src/web/file3.ts',
  ]);
  assert.equal(braces.compile('{a,b}'), '(a|b)');
  assert.equal(braces.stringify(braces.parse('{a,b}')), '{a,b}');
  for (const pattern of [
    '{'.repeat(4000) + 'a' + '}'.repeat(4000),
    '('.repeat(4000) + 'a' + ')'.repeat(4000),
    '{'.repeat(4000) + 'a',
  ]) {
    assert.throws(
      () => braces.compile(pattern),
      (e) => e instanceof RangeError && e.message === 'Pattern nesting exceeds build limit',
    );
    assert.throws(
      () => braces.expand(pattern),
      (e) => e instanceof RangeError && e.message === 'Pattern nesting exceeds build limit',
    );
  }
  const ast = { type: 'root', nodes: [] };
  let node = ast;
  for (let i = 0; i < 6000; i++) {
    const child = { type: 'root', nodes: [] };
    node.nodes.push(child);
    node = child;
  }
  for (const method of ['compile', 'expand', 'stringify'])
    assert.throws(
      () => braces[method](ast),
      (e) => e instanceof RangeError && e.message === 'Pattern nesting exceeds build limit',
    );
});
test('RSA backport rejects nested DigestAlgorithm garbage accepted by the stock library and matches OpenSSL positives', () => {
  const forge = require('node-forge');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent: 3 });
  const pem = publicKey.export({ format: 'pem', type: 'spki' }),
    priv = forge.pki.privateKeyFromPem(privateKey.export({ format: 'pem', type: 'pkcs1' }));
  const strict = forge.pki.publicKeyFromPem(pem);
  const message = 'mobile build signing regression';
  const md = forge.md.sha256.create().update(message),
    digest = md.digest().getBytes();
  const good = priv.sign(md);
  assert.equal(strict.verify(digest, good), true);
  assert.equal(verify('sha256', Buffer.from(message), publicKey, Buffer.from(good, 'binary')), true);
  // Isolated stock factory proves the regression input exercises the actual advisory.
  const path = require.resolve('node-forge/lib/rsa');
  const patch = require('../patches/build-hardening.json').patches.find((p) => p.package === 'node-forge');
  let original = fs.readFileSync(path, 'utf8');
  for (const change of patch.changes) original = original.replace(change.after, change.before);
  assert.equal(createHash('sha256').update(original).digest('hex'), patch.beforeSha256);
  const baseline = new Module(path, module);
  baseline.filename = path;
  baseline.paths = Module._nodeModulePaths(require('node:path').dirname(path));
  baseline._compile(original, path);
  const stock = forge.pki.publicKeyFromPem(pem),
    a = forge.asn1;
  const make = (nullParameter) => {
    const algorithm = [
      a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(forge.oids.sha256).getBytes()),
      ...(nullParameter ? [a.create(a.Class.UNIVERSAL, a.Type.NULL, false, '')] : []),
      a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, 'unconsumed padding'),
    ];
    const info = a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
      a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, algorithm),
      a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, digest),
    ]);
    return priv.sign(a.toDer(info).getBytes(), null);
  };
  for (const parameter of [true, false]) {
    const signature = make(parameter);
    assert.equal(
      stock.verify(digest, signature),
      true,
      'Stock release should reproduce the signature-parsing flaw',
    );
    assert.equal(verify('sha256', Buffer.from(message), publicKey, Buffer.from(signature, 'binary')), false);
    assert.throws(() => strict.verify(digest, signature), /DigestInfo/);
  }
});

test('course route parameters use the fixed ESM decoder through the existing CommonJS query parser', () => {
  const qs = require('query-string');
  assert.deepEqual(
    { ...qs.parse('courseId=lesson_123&q=%E4%B8%AD%E6%96%87') },
    { courseId: 'lesson_123', q: '中文' },
  );
  assert.equal(qs.stringify({ courseId: 'lesson_123' }), 'courseId=lesson_123');
  const decode = require('decode-uri-component').default;
  assert.equal(decode('a%20b'), 'a b');
  require('node:child_process').execFileSync(
    process.execPath,
    [
      '-e',
      "const d=require('decode-uri-component').default;if(typeof d('%C0'.repeat(10000))!=='string')process.exit(1)",
    ],
    { cwd: require('node:path').resolve(__dirname, '..'), timeout: 3000, stdio: 'pipe' },
  );
});
