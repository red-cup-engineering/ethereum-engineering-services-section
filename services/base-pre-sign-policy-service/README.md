# Base pre-sign policy service

Deterministically evaluates one unsigned Base transaction against a declared
policy and immutable block anchor. It accepts no credentials, custody,
signatures, signing, broadcast authority, or state mutation, so public
products can use one Base evaluator without owning a fork.
