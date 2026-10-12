# ERC-4337 Bundler Services Section

This independently hireable provider exposes the standard ERC-4337/ERC-7769
JSON-RPC boundary through Alto. Its executor authority is opened from the
provider settlement's Ethereum Secret Storage v3 keystore; raw executor keys
are neither repository configuration nor process arguments.

Run `npm run serve -- --entry-point <address> --rpc-url <url> --keystore
<path> --password-file <device-private-path>`. The provider refuses public
keystores and password files. Enterprise customers submit UserOperations only
through the ERC-7769 methods; they do not acquire the executor authority.
Safe validation is the default. A development chain may explicitly pass
`--safe-mode false`; that relaxation belongs to the provider invocation and is
not embedded in a customer or account.

This settlement exposes the standard ERC-7769 JSON-RPC face needed by Union
ERC-4337 enterprise accounts. It carries the maintained Alto implementation;
consumer enterprises submit UserOperations to its explicit boundary and do not
embed or impersonate a bundler.

Chain RPC, EntryPoint, executor account, and admission policy remain explicit
operator configuration. The bundler never becomes an inference scheduler or a
global Union work queue.
