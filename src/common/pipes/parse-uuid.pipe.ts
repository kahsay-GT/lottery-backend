import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { validate as uuidValidate } from 'uuid';

@Injectable()
export class ParseUUIDPipe implements PipeTransform<string> {
  transform(value: string): string {
    if (!uuidValidate(value)) {
      throw new BadRequestException(`Invalid UUID: ${value}`);
    }
    return value;
  }
}
