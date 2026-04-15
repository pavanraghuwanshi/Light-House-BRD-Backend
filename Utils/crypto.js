import crypto from "crypto";



// 🔐 Encrypt function
const encrypt = (text) => {
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from( process.env.ENCRYPTION_KEY), process.env.IV);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString("hex");
};

// 🔓 Decrypt function
const decrypt = (encryptedText) => {
  const encryptedBuffer = Buffer.from(encryptedText, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from( process.env.ENCRYPTION_KEY), process.env.IV);
  let decrypted = decipher.update(encryptedBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

const comparePassword = (enteredPassword, encryptedStoredPassword) => {
  const decryptedPassword = decrypt(encryptedStoredPassword);
  return enteredPassword === decryptedPassword;
};

export { encrypt, decrypt, comparePassword };
