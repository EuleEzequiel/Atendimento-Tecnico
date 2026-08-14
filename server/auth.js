import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  console.warn("AVISO: JWT_SECRET ausente ou com menos de 32 caracteres.");
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    secret,
    { expiresIn: "8h" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: "Sessão expirada ou inválida." });
  }
}
