import { describePasswordHasherConformance } from "./conformance/password-hasher";
import { Argon2PasswordHasher } from "./password-hasher";

describePasswordHasherConformance(
    "argon2 hasher",
    () => new Argon2PasswordHasher(),
);