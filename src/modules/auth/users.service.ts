import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';

export interface OAuth2UserProfile {
  sub: string;
  email?: string;
  name?: string;
  rawProfile: Record<string, unknown>;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async findById(id: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByProviderAndSubject(
    provider: string,
    subject: string,
  ): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { provider, subject } });
  }

  async upsertOAuth2User(
    provider: string,
    profile: OAuth2UserProfile,
  ): Promise<UserEntity> {
    const existing = await this.findByProviderAndSubject(provider, profile.sub);

    if (existing) {
      existing.email = profile.email ?? existing.email;
      existing.name = profile.name ?? existing.name;
      existing.profile = profile.rawProfile;
      return this.usersRepository.save(existing);
    }

    const created = this.usersRepository.create({
      provider,
      subject: profile.sub,
      email: profile.email ?? null,
      name: profile.name ?? null,
      profile: profile.rawProfile,
    });

    return this.usersRepository.save(created);
  }
}
