import crypto from "crypto";

const DEFAULT_KEY = "12345678901234567890123456789012"; // 32-byte default key
const DEFAULT_IV = "1234567890123456"; // 16-byte default IV

const getKey = () => {
  const rawKey = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
  return Buffer.from(rawKey.padEnd(32, "0").slice(0, 32));
};

const getIV = () => {
  const rawIv = process.env.IV || DEFAULT_IV;
  return Buffer.from(rawIv.padEnd(16, "0").slice(0, 16));
};

// 🔐 Encrypt function
const encrypt = (text) => {
  if (!text) return "";
  const key = getKey();
  const iv = getIV();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(String(text));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString("hex");
};

// 🔓 Decrypt function
const decrypt = (encryptedText) => {
  if (!encryptedText) return "";
  try {
    const key = getKey();
    const iv = getIV();
    const encryptedBuffer = Buffer.from(encryptedText, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    // If text was plaintext or decryption failed, return original text
    return encryptedText;
  }
};

const comparePassword = (enteredPassword, encryptedStoredPassword) => {
  if (!enteredPassword || !encryptedStoredPassword) return false;
  // If stored password equals entered plain text
  if (enteredPassword === encryptedStoredPassword) return true;
  // Decrypt and compare
  const decryptedPassword = decrypt(encryptedStoredPassword);
  return enteredPassword === decryptedPassword;
};

export { encrypt, decrypt, comparePassword };
