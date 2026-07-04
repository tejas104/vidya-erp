import argon2 from "argon2";
import { randomBytes } from "node:crypto";

import type { PasswordHasher } from "./contracts";

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
};

const DUMMY_HASH = await argon2.hash(
    randomBytes(32),
    ARGON2_OPTIONS,
);

export class Argon2PasswordHasher implements PasswordHasher {
    public readonly dummyHash = DUMMY_HASH;

    async hash(password: string): Promise<string> {
        return argon2.hash(password, ARGON2_OPTIONS);
    }

    async verify(
        hash: string,
        password: string,
    ): Promise<boolean> {
        try {
            return await argon2.verify(hash, password);
        } catch {
            return false;
        }
    }

    needsRehash(hash: string): boolean {
        try {
            return argon2.needsRehash(hash, ARGON2_OPTIONS);
        } catch {
            // Malformed hashes should simply be considered unusable.
            return true;
        }
    }
}