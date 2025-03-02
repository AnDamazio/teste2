/* eslint-disable @typescript-eslint/no-empty-function */
import { PersonalDataServices } from "../service/use-cases/personal-data/personal-data-services.service";
import { PersonalDataFactoryService } from "../service/use-cases/personal-data/personal-data-factory.service";
import { UserSituationFactoryService } from "src/service/use-cases/userSituation";
import { UserSituationServices } from "src/service/use-cases/userSituation";
import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  Param,
  Put,
  Get,
} from "@nestjs/common";
import {
  CreatePersonalDataDto,
  CreateUserDto,
  CreateUserResponseDto,
} from "../core/dtos";
import { UserServices } from "src/service/use-cases/user/user-services.service";
import { UserFactoryService } from "src/service/use-cases/user";
import { LocalAuthGuard } from "src/frameworks/auth/local-auth.guard";
import * as nodemailer from "nodemailer";
import { SMTP_CONFIG } from "../smtp/smtp-config";
import { AuthService } from "src/frameworks/auth/auth.service";
import * as jwt from "jsonwebtoken";
import { PictureDto } from "../core/dtos";

const transport = nodemailer.createTransport({
  service: SMTP_CONFIG.service,
  host: SMTP_CONFIG.host,
  port: SMTP_CONFIG.port,
  secure: false,
  auth: {
    user: SMTP_CONFIG.user,
    pass: SMTP_CONFIG.pass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

@Controller("api/user")
export class UserController {
  constructor(
    private userServices: UserServices,
    private authService: AuthService,
    private userFactoryService: UserFactoryService,
    private personalDataServices: PersonalDataServices,
    private personalDataFactoryService: PersonalDataFactoryService,
    private userSituationServices: UserSituationServices,
    private userSituationFactoryService: UserSituationFactoryService
  ) { }

  @Post()
  async createUser(@Body() userDto: CreateUserDto) {
    const createUserResponse = new CreateUserResponseDto();
    {
      try {
        userDto.personalData.password =
          await this.personalDataFactoryService.encryptPassword(
            userDto.personalData.password
          );
        const personalData =
          await this.personalDataFactoryService.createNewPersonalData(
            userDto.personalData
          );
        const createdPersonalData =
          await this.personalDataServices.createPersonalData(personalData);
        userDto.personalData = createdPersonalData;
        const userSituation =
          this.userSituationFactoryService.createnewUserSituation(
            userDto.userSituation
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

        transport
          .sendMail({
            text: `Obrigado por se cadastrar no Book4U, SEJA BEM VINDO! Aqui está seu código de verificação ${user.registerNumber}`,
            subject: `Confirmação de cadastro`,
            from: SMTP_CONFIG.user,
            to: createdPersonalData.email,
          })
          .then((param) => console.log(param))
          .catch((error) => console.log(error));

        return user.registerNumber;
      } catch (err) {
        createUserResponse.success = false;
        return err.message;
      }
    }
  }

  @UseGuards(LocalAuthGuard)
  @Post("auth/login")
  async login(@Request() req) {
    try {
      if (req.user.user.userSituation.name == "Confirmado") {
        return await this.authService.login(req.user);
      } else {
        return "E-mail pendente"
      }
    } catch (err) {
      return err.message
    }
  }

  @Put(":token")
  async setProfilePic(
    @Body() pictureDto: PictureDto,
    @Param("token") token: string
  ) {
    try {
      const destructToken: any = jwt.decode(token);
      const user = await this.userServices.findByEmail(destructToken.email);
      const id = await this.userServices.getIdFromUser(user);
      const userFound = await this.userServices.getUserById(id);
      if (userFound) {
        userFound.picture = pictureDto.picture;
        await this.userServices.updateUser(Number(id), userFound);
        return "Imagem trocada com sucesso!";
      } else {
        return "Usuário não encontrado";
      }
    } catch (err) {
      return {
        defaultError: err.message,
        editedError: "Erro ao alterar imagem, por favor tente novamente",
      };
    }
  }

  @Put("confirmRegistration/:rNumber")
  async confirmRegistration(@Param("rNumber") rNumber: string) {
    try {
      await this.userSituationServices.insertEnumValue();
      const userFound = await this.userServices.getUserByNRegister(rNumber);
      const getIdFromUser = await this.userServices.getIdFromUser(userFound);
      if (userFound.registerNumber == rNumber) {
        await this.userServices.setSituationUser(
          Number(getIdFromUser),
          (userFound.userSituation.name = "CONFIRMADO")
        );
        const user = {
          email: userFound.personalData.email,
          password: userFound.personalData.password,
        };
        return await this.authService.login(user);
      }
    } catch (err) {
      return {
        defaultError: err.message,
        editedError: "Por favor, digite um número válido",
      };
    }
  }

  @Put("resendRNumber/:email")
  async resendRNumber(@Param("email") email: string) {
    const userFound = await this.userServices.findByEmail(email);
    const getIdFromUser = await this.userServices.getIdFromUser(userFound);
    try {
      if (userFound) {
        function generateNewNumber() {
          const nGenerated = String(Math.floor(Math.random() * 3000) + 1);
          if (nGenerated.length == 4) {
            userFound.registerNumber = nGenerated;
          } else {
            generateNewNumber();
          }
        }
        generateNewNumber();
        transport
          .sendMail({
            text: `Seu novo código de registro é: ${userFound.registerNumber}`,
            subject: `Novo número de registro`,
            from: SMTP_CONFIG.user,
            to: userFound.personalData.email,
          })
          .then(
            await this.userServices.updateUser(Number(getIdFromUser), userFound)
          )
          .catch((error) => {
            return error;
          });
        return userFound.registerNumber;
      } else {
        return "Usuário não encontrado";
      }
    } catch (err) {
      return err.message;
    }
  }

  @Put("exchangePassword/:email")
  async exchangePassword(
    @Param("email") email: string,
    @Body("password") password: CreatePersonalDataDto["password"]
  ) {
    const userFound = await this.personalDataServices.findByEmail(email);
    const getIdFromPersonalData =
      await this.personalDataServices.getIdFromPersonalData(userFound);
    if (userFound) {
      userFound.password =
        await this.personalDataFactoryService.encryptPassword(String(password));
      await this.personalDataServices.exchangePassword(
        Number(getIdFromPersonalData),
        userFound
      );
      return "Senha alterada com sucesso";
    } else {
      return "Erro ao alterar dado de situação de usuário para confirmado";
    }
  }

  @Get("getUserByToken/:token")
  async getUserById(@Param("token") token: string) {
    try {
      const destructToken: any = jwt.decode(token);
      const user = await this.userServices.findByEmail(destructToken.email);
      const id = await this.userServices.getIdFromUser(user);
      return await this.userServices.getUserById(id);
    } catch (err) {
      return err.message;
    }
  }

  @Get("getUserCredits/:token")
  async getUserCredits(@Param('token') token: string) {
    try {
      const destructToken: any = jwt.decode(token);
      const user = await this.userServices.findByEmail(destructToken.email);
      return user.credits;
    } catch (err) {
      return err.message
    }
  }
}

