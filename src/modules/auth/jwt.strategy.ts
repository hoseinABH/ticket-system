import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import Redis from 'ioredis';
import { REDIS } from '../../core/redis/redis.module';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secret-key-2026',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    // Check Redis blocklist in case the user logged out
    const isRevoked = await this.redis.get(`bl:${payload.jti}`);
    if (isRevoked) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return { userId: payload.sub, email: payload.email, jti: payload.jti };
  }
}
