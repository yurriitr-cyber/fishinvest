import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class BuyDto {
  @IsUUID()
  fishId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class SellDto {
  @IsUUID()
  fishId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
