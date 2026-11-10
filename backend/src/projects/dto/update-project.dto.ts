import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: '项目名称不能为空' })
  @MaxLength(80, { message: '项目名称不能超过 80 个字符' })
  name!: string;
}
