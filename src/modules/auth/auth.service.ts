import {
  Injectable,
  Inject,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { REDIS } from '../../core/redis/redis.module';
import { users } from '../../core/database/schema';
import { AuthCredentialsDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: AuthCredentialsDto) {
    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.email, dto.email));
    if (existing.length > 0) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const [newUser] = await this.db
      .insert(users)
      .values({ email: dto.email, passwordHash })
      .returning({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
      });

    return newUser;
  }

  async login(dto: AuthCredentialsDto) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, dto.email));
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const jti = randomUUID();
    const payload = { sub: user.id, email: user.email, jti };
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken, user: { id: user.id, email: user.email } };
  }

  async logout(jti: string) {
    // Store revoked token ID in Redis with a 1-hour TTL matching JWT expiration
    await this.redis.set(`bl:${jti}`, 'revoked', 'EX', 3600);
    return { message: 'Logged out successfully' };
  }
}
