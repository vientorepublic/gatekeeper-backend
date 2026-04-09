import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class InitialAuthSchema20260409000000 implements MigrationInterface {
  name = 'InitialAuthSchema20260409000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasUsersTable = await queryRunner.hasTable('users');

    if (!hasUsersTable) {
      await queryRunner.createTable(
        new Table({
          name: 'users',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
            },
            {
              name: 'provider',
              type: 'varchar',
              length: '64',
              isNullable: false,
            },
            {
              name: 'subject',
              type: 'varchar',
              length: '191',
              isNullable: false,
            },
            {
              name: 'email',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'name',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'avatarUrl',
              type: 'varchar',
              length: '1024',
              isNullable: true,
            },
            {
              name: 'profile',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updatedAt',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
          uniques: [
            {
              name: 'UQ_users_provider_subject',
              columnNames: ['provider', 'subject'],
            },
          ],
        }),
      );
    }

    const hasApiKeysTable = await queryRunner.hasTable('api_keys');

    if (!hasApiKeysTable) {
      await queryRunner.createTable(
        new Table({
          name: 'api_keys',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
            },
            {
              name: 'userId',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'namespace',
              type: 'varchar',
              length: '64',
              default: "''",
            },
            {
              name: 'keyPrefix',
              type: 'varchar',
              length: '24',
              isNullable: false,
            },
            {
              name: 'keyHash',
              type: 'varchar',
              length: '64',
              isNullable: false,
            },
            {
              name: 'label',
              type: 'varchar',
              length: '128',
              isNullable: true,
            },
            {
              name: 'lastUsedAt',
              type: 'datetime',
              isNullable: true,
            },
            {
              name: 'revokedAt',
              type: 'datetime',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
          uniques: [
            {
              name: 'UQ_api_keys_keyHash',
              columnNames: ['keyHash'],
            },
          ],
        }),
      );

      await queryRunner.createIndices('api_keys', [
        new TableIndex({
          name: 'IDX_api_keys_userId',
          columnNames: ['userId'],
        }),
        new TableIndex({
          name: 'IDX_api_keys_namespace',
          columnNames: ['namespace'],
        }),
        new TableIndex({
          name: 'IDX_api_keys_keyPrefix',
          columnNames: ['keyPrefix'],
        }),
      ]);

      await queryRunner.createForeignKey(
        'api_keys',
        new TableForeignKey({
          name: 'FK_api_keys_userId_users_id',
          columnNames: ['userId'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasApiKeysTable = await queryRunner.hasTable('api_keys');
    if (hasApiKeysTable) {
      await queryRunner.dropTable('api_keys');
    }

    const hasUsersTable = await queryRunner.hasTable('users');
    if (hasUsersTable) {
      await queryRunner.dropTable('users');
    }
  }
}
