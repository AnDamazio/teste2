import { PersonalDataServices } from '../service/use-cases/personal-data/personal-data-services.service';
import { PersonalDataFactoryService } from '../service/use-cases/personal-data/personal-data-factory.service';
import { UserSituationFactoryService } from 'src/service/use-cases/userSituation';
import { UserSituationServices } from 'src/service/use-cases/userSituation';
import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  Param,
  UseInterceptors,
  UploadedFile,
  Put,
} from '@nestjs/common';
import {
  CreateUserDto,
  CreateUserResponseDto,
  UserSituationDto,
} from '../core/dtos';
import { UserServices } from 'src/service/use-cases/user/user-services.service';
import { UserFactoryService } from 'src/service/use-cases/user';
import { LocalAuthGuard } from 'src/frameworks/auth/local-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';
import { storage } from '../firebase';
import * as nodemailer from 'nodemailer';
import { SMTP_CONFIG } from '../smtp/smtp-config';
import { EnumUserSituation } from 'src/core';

const transport = nodemailer.createTransport({
  service: SMTP_CONFIG.service,
  host: SMTP_CONFIG.host,
  port: SMTP_CONFIG.port,
  secure: false,
  auth: {
    user: SMTP_CONFIG.user,
    pass: SMTP_CONFIG.pass
  },
  tls: {
    rejectUnauthorized: false
  }
})

@Controller('api/user')
export class UserController {
  constructor(
    private userServices: UserServices,
    private userFactoryService: UserFactoryService,
    private personalDataServices: PersonalDataServices,
    private personalDataFactoryService: PersonalDataFactoryService,
    private userSituationServices: UserSituationServices,
    private userSituationFactoryService: UserSituationFactoryService,
  ) { }

  @Post()
  async createUser(@Body() userDto: CreateUserDto) {

    const createUserResponse = new CreateUserResponseDto();
    {
      try {
        const personalData =
          this.personalDataFactoryService.createNewPersonalData(
            userDto.personalData,
          );
        const createdPersonalData =
          await this.personalDataServices.createPersonalData(
            await personalData,
          );
        userDto.personalData = createdPersonalData;
        const userSituation =
          this.userSituationFactoryService.createnewUserSituation(
            userDto.userSituation,
          );
        const createdUserSituation =
          await this.userSituationServices.createUserSituation(userSituation);
        userDto.userSituation = createdUserSituation;

        const user = this.userFactoryService.createNewUser(userDto);
        function generateNewNumber() {
          const nGenerated = String(Math.floor(Math.random() * 3000) + 1);
          if (nGenerated.length == 4) {
            user.registerNumber = nGenerated;
          } else {
            generateNewNumber();
          }
        }
        generateNewNumber();

        const createdUser = await this.userServices.createUser(user);
        createUserResponse.createdUser = createdUser;

        transport.sendMail({
          text: `Obrigado por se cadastrar no Book4U, SEJA BEM VINDO! Aqui está seu código de verificação ${user.registerNumber}`,
          subject: `Confirmação de cadastro`,
          from: SMTP_CONFIG.user,
          to: createdPersonalData.email,
        }).then(
          (param) => console.log(param)
        ).catch(error => console.log(error))

        return createUserResponse;
      } catch (error) {
        createUserResponse.success = false;
        return error
      }
    }
  }

  @UseGuards(LocalAuthGuard)
  @Post('auth/login')
  async login(@Request() req) {
    return req.user;
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('profileImage'))
  async setProfilePic(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userFound = this.userServices.getUserById(id);
    const createUserResponse = new CreateUserResponseDto();
    if ((await userFound).profileImage != '') {
      const userPic = (await userFound).profileImage;
      const fileRef = ref(storage, userPic);
      deleteObject(fileRef)
        .then()
        .catch((error) => console.log(error));
    }
    const fileName = Date.now() + '_' + file.originalname;
    const fileRef = ref(storage, fileName);
    uploadBytes(fileRef, file.buffer)
      .then(async () => {
        const createdProfilePic = await this.userServices.setProfilePic(
          id,
          fileName,
        );
        return (createUserResponse.createdUser = createdProfilePic);
      })
      .catch((error) => console.log(error));
  }

  @Put('confirmRegistration/:rNumber')
  async confirmRegistration(@Param('rNumber') rNumber: string) {
    const userFound = await this.userServices.getUserByNRegister(rNumber);
    const getIdFromUser = await this.userServices.getIdFromUser(userFound);
    const createUserResponse = new CreateUserResponseDto();
    if (userFound.registerNumber == rNumber) {
      const newUserSituation = await this.userServices.setSituationUser(
        Number(getIdFromUser),
        (userFound.userSituation.name = 'CONFIRMADO'),
      );
      return (createUserResponse.createdUser = newUserSituation);
    } else {
      return console.log(
        'Erro ao alterar dado de situação de usuário para confirmado',
      );
    }
  }

  @Put('resendRNumber/:email')
  async resendRNumber(@Param('email') email: string) {
    const userFound = await this.userServices.findByEmail(email);
    const createUserResponse = new CreateUserResponseDto();
    if (userFound) {
      function generateNewNumber() {
        const nGenerated = String(Math.floor(Math.random() * 3000) + 1)
        if (nGenerated.length == 4) {
          userFound.registerNumber = nGenerated
        } else {
          generateNewNumber()
        }
      }
      generateNewNumber()
      transport.sendMail({
        text: `Código para mudar a senha: ${userFound.registerNumber}`,
        subject: `Confirmação de cadastro`,
        from: SMTP_CONFIG.user,
        to: userFound.personalData.email,
      }).then(
        (param) => console.log(param)
      ).catch(error => console.log(error))
      createUserResponse.createdUser = userFound;
    } else {
      return Error("Email não encontrado na base de dados")
    }
  }

  @Put('exchangePassword/:rNumber')
  async exchangePassword(@Param('rNumber') rNumber: string, @Body() userDto: CreateUserDto) {
    const userFound = await this.userServices.getUserByNRegister(rNumber)
    const getIdFromPersonalData = await this.personalDataServices.getIdFromPersonalData(userFound.personalData)
    const createUserResponse = new CreateUserResponseDto();
    if (userFound.registerNumber == rNumber) {
      const unewUserPassword = userFound.personalData.password = userDto.personalData.password;
      console.log(unewUserPassword)
      const newPassword = await this.personalDataServices.exchangePassword(Number(getIdFromPersonalData), userFound.personalData)
      console.log(newPassword)
      return createUserResponse.createdUser = newPassword;
    } else {
      return console.log("Erro ao alterar dado de situação de usuário para confirmado")
    }
  }
}
