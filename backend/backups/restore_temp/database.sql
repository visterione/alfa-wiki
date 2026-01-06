--
-- PostgreSQL database dump
--

\restrict aJuieidNvcBlboQ6KUJV0OKDuEodEo0ta8cA3lGvQPxX5lgNrsyrboYD4CcdrLD

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enum_accreditations_medCenter; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."enum_accreditations_medCenter" AS ENUM (
    'Альфа',
    'Кидс',
    'Проф',
    'Линия',
    'Смайл',
    '3К'
);


ALTER TYPE public."enum_accreditations_medCenter" OWNER TO postgres;

--
-- Name: enum_chat_members_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.enum_chat_members_role AS ENUM (
    'admin',
    'member'
);


ALTER TYPE public.enum_chat_members_role OWNER TO postgres;

--
-- Name: enum_chats_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.enum_chats_type AS ENUM (
    'private',
    'group'
);


ALTER TYPE public.enum_chats_type OWNER TO postgres;

--
-- Name: enum_messages_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.enum_messages_type AS ENUM (
    'text',
    'image',
    'file',
    'system'
);


ALTER TYPE public.enum_messages_type OWNER TO postgres;

--
-- Name: enum_pages_contentType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."enum_pages_contentType" AS ENUM (
    'wysiwyg',
    'html'
);


ALTER TYPE public."enum_pages_contentType" OWNER TO postgres;

--
-- Name: enum_sidebar_items_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.enum_sidebar_items_type AS ENUM (
    'page',
    'folder',
    'header',
    'link',
    'divider'
);


ALTER TYPE public.enum_sidebar_items_type OWNER TO postgres;

--
-- Name: enum_vehicles_condition; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.enum_vehicles_condition AS ENUM (
    'Хорошее',
    'Удовлетворительное',
    'Плохое'
);


ALTER TYPE public.enum_vehicles_condition OWNER TO postgres;

--
-- Name: enum_vehicles_organization; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.enum_vehicles_organization AS ENUM (
    'Альфа',
    'Кидс',
    'Проф',
    'Линия',
    'Смайл',
    '3К'
);


ALTER TYPE public.enum_vehicles_organization OWNER TO postgres;

--
-- Name: med_center_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.med_center_enum AS ENUM (
    'Альфа',
    'Кидс',
    'Проф',
    'Линия',
    'Смайл',
    '3К'
);


ALTER TYPE public.med_center_enum OWNER TO postgres;

--
-- Name: vehicle_condition_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.vehicle_condition_enum AS ENUM (
    'Хорошее',
    'Удовлетворительное',
    'Плохое'
);


ALTER TYPE public.vehicle_condition_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accreditations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.accreditations (
    id uuid NOT NULL,
    "medCenter" public."enum_accreditations_medCenter" NOT NULL,
    "fullName" character varying(255) NOT NULL,
    specialty character varying(255) NOT NULL,
    "expirationDate" date NOT NULL,
    comment text,
    reminded90 boolean DEFAULT false,
    reminded60 boolean DEFAULT false,
    reminded30 boolean DEFAULT false,
    reminded14 boolean DEFAULT false,
    reminded7 boolean DEFAULT false,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.accreditations OWNER TO postgres;

--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_members (
    id uuid NOT NULL,
    "chatId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role public.enum_chat_members_role DEFAULT 'member'::public.enum_chat_members_role,
    "lastReadAt" timestamp with time zone,
    "isNotificationMuted" boolean DEFAULT false,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.chat_members OWNER TO postgres;

--
-- Name: chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chats (
    id uuid NOT NULL,
    name character varying(255),
    type public.enum_chats_type DEFAULT 'private'::public.enum_chats_type,
    avatar character varying(500),
    "lastMessage" text,
    "lastMessageAt" timestamp with time zone,
    "createdBy" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.chats OWNER TO postgres;

--
-- Name: doctor_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctor_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "pageSlug" character varying(255) NOT NULL,
    "fullName" character varying(255) NOT NULL,
    specialty character varying(255),
    experience character varying(100),
    "profileUrl" character varying(1000),
    photo character varying(1000),
    description text,
    phones jsonb DEFAULT '[]'::jsonb,
    "sortOrder" integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "misUserId" character varying(50)
);


ALTER TABLE public.doctor_cards OWNER TO postgres;

--
-- Name: folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.folders (
    id uuid NOT NULL,
    title character varying(255) NOT NULL,
    icon character varying(50) DEFAULT 'folder'::character varying,
    "parentId" uuid,
    "sortOrder" integer DEFAULT 0,
    description text,
    "createdBy" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.folders OWNER TO postgres;

--
-- Name: map_markers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.map_markers (
    id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    color character varying(20) DEFAULT '#4a90e2'::character varying,
    media jsonb DEFAULT '[]'::jsonb,
    category character varying(100),
    "createdBy" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.map_markers OWNER TO postgres;

--
-- Name: media; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.media (
    id uuid NOT NULL,
    filename character varying(255) NOT NULL,
    "originalName" character varying(255),
    "mimeType" character varying(100),
    size integer,
    path character varying(1000) NOT NULL,
    "thumbnailPath" character varying(1000),
    alt character varying(500),
    description text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "uploadedBy" uuid
);


ALTER TABLE public.media OWNER TO postgres;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id uuid NOT NULL,
    "chatId" uuid NOT NULL,
    "senderId" uuid NOT NULL,
    content text NOT NULL,
    type public.enum_messages_type DEFAULT 'text'::public.enum_messages_type,
    attachments jsonb DEFAULT '[]'::jsonb,
    "isEdited" boolean DEFAULT false,
    "replyToId" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: pages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pages (
    id uuid NOT NULL,
    slug character varying(255) NOT NULL,
    title character varying(500) NOT NULL,
    content text,
    "contentType" public."enum_pages_contentType" DEFAULT 'wysiwyg'::public."enum_pages_contentType",
    description text,
    keywords character varying(255)[] DEFAULT (ARRAY[]::character varying[])::character varying(255)[],
    "searchContent" text,
    icon character varying(50),
    "folderId" uuid,
    "sortOrder" integer DEFAULT 0,
    "isPublished" boolean DEFAULT false,
    "isFavorite" boolean DEFAULT false,
    "allowedRoles" uuid[] DEFAULT ARRAY[]::uuid[],
    "customCss" text,
    "customJs" text,
    metadata jsonb DEFAULT '{}'::jsonb,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "createdBy" uuid,
    "updatedBy" uuid
);


ALTER TABLE public.pages OWNER TO postgres;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    permissions jsonb DEFAULT '{"pages": {"read": true, "admin": false, "write": false, "delete": false}}'::jsonb,
    "isSystem" boolean DEFAULT false,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: search_index; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.search_index (
    id uuid NOT NULL,
    "entityType" character varying(50) NOT NULL,
    "entityId" uuid NOT NULL,
    title character varying(500),
    content text,
    keywords character varying(255)[] DEFAULT (ARRAY[]::character varying[])::character varying(255)[],
    url character varying(1000),
    metadata jsonb DEFAULT '{}'::jsonb,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.search_index OWNER TO postgres;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.settings (
    key character varying(100) NOT NULL,
    value jsonb,
    description text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.settings OWNER TO postgres;

--
-- Name: sidebar_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sidebar_items (
    id uuid NOT NULL,
    type public.enum_sidebar_items_type DEFAULT 'page'::public.enum_sidebar_items_type,
    title character varying(255),
    icon character varying(50),
    "pageId" uuid,
    "folderId" uuid,
    "externalUrl" character varying(1000),
    "parentId" uuid,
    "sortOrder" integer DEFAULT 0,
    "isExpanded" boolean DEFAULT true,
    "allowedRoles" uuid[] DEFAULT ARRAY[]::uuid[],
    "isVisible" boolean DEFAULT true,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.sidebar_items OWNER TO postgres;

--
-- Name: telegram_subscribers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.telegram_subscribers (
    id uuid NOT NULL,
    "chatId" character varying(50) NOT NULL,
    username character varying(100),
    "firstName" character varying(100),
    "lastName" character varying(100),
    "isActive" boolean DEFAULT true,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "subscribeAccreditations" boolean DEFAULT true,
    "subscribeVehicles" boolean DEFAULT true
);


ALTER TABLE public.telegram_subscribers OWNER TO postgres;

--
-- Name: user_favorites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_favorites (
    id uuid NOT NULL,
    "userId" uuid NOT NULL,
    "pageId" uuid NOT NULL,
    "sortOrder" integer DEFAULT 0,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.user_favorites OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    username character varying(50) NOT NULL,
    password character varying(255) NOT NULL,
    "displayName" character varying(100),
    email character varying(255),
    avatar character varying(500),
    "isActive" boolean DEFAULT true,
    "isAdmin" boolean DEFAULT false,
    "lastLogin" timestamp with time zone,
    settings jsonb DEFAULT '{}'::jsonb,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "roleId" uuid
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicles (
    id uuid NOT NULL,
    organization public.enum_vehicles_organization NOT NULL,
    "carBrand" character varying(255) NOT NULL,
    "licensePlate" character varying(50) NOT NULL,
    "carYear" integer NOT NULL,
    mileage integer DEFAULT 0 NOT NULL,
    "nextTO" integer DEFAULT 0 NOT NULL,
    "insuranceDate" date NOT NULL,
    condition public.enum_vehicles_condition NOT NULL,
    comment text,
    reminded90 boolean DEFAULT false,
    reminded60 boolean DEFAULT false,
    reminded30 boolean DEFAULT false,
    reminded14 boolean DEFAULT false,
    reminded7 boolean DEFAULT false,
    "remindedTO" boolean DEFAULT false,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.vehicles OWNER TO postgres;

--
-- Data for Name: accreditations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.accreditations (id, "medCenter", "fullName", specialty, "expirationDate", comment, reminded90, reminded60, reminded30, reminded14, reminded7, "createdAt", "updatedAt") FROM stdin;
775f3a70-71e7-436a-9f3f-769ee0eb02ca	Альфа	Петров Владислав Александрович	Терапия	2026-01-02	Тестовый врач	f	f	f	f	f	2026-01-01 22:26:37.1+03	2026-01-01 22:26:37.1+03
5911fa9d-2205-42fe-839d-89cb0878b0e3	Кидс	Юдина Виктория Павловна	Гинекология	2026-02-10	Проверка	f	f	f	f	f	2026-01-01 22:27:03.869+03	2026-01-01 22:27:03.869+03
4d98aa18-082f-4206-a886-b5f691ea432c	Проф	Грудинкина Марина Владимировна	Стоматология	2026-03-03	Чек	f	f	f	f	f	2026-01-01 22:27:43.195+03	2026-01-01 22:27:43.195+03
98bb7c25-2b83-4d13-bafa-59defc08ce12	Линия	Капкан Даниил Дмитриевич	Дерматология	2026-04-04	Дерматовенеролог	f	f	f	f	f	2026-01-01 22:28:18.687+03	2026-01-01 22:28:18.687+03
3958a388-e83e-4fd8-a8e9-badcc97b1778	Смайл	Стеценко Виталий Витальевич	Ортодонтия	2026-05-05	Ортодонт	f	f	f	f	f	2026-01-01 22:28:47.671+03	2026-01-01 22:28:47.671+03
afa3fbc0-4905-459f-b66a-305acfcd8c35	3К	Комиссаров Александр Сергеевич	Психотерапия	2025-12-31	Просрочен	f	f	f	f	f	2026-01-01 22:29:28.698+03	2026-01-01 22:29:28.698+03
\.


--
-- Data for Name: chat_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chat_members (id, "chatId", "userId", role, "lastReadAt", "isNotificationMuted", "createdAt", "updatedAt") FROM stdin;
d3234b8f-a883-4cc0-b3f1-83769ad3ecc4	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	c575d874-1e15-447f-b2cf-90f4ae8a69b8	member	\N	f	2026-01-03 19:50:54.414+03	2026-01-03 19:50:54.414+03
d21d379e-3b98-4616-b0e6-8aaee73d836b	0f620089-d281-4837-853e-a9564fe1241c	476cbc64-17c4-461a-9a16-be5e24e6fcf0	member	\N	f	2026-01-03 19:55:04.315+03	2026-01-03 19:55:04.315+03
73e76492-ae76-49bc-ac98-7732bca90503	0f620089-d281-4837-853e-a9564fe1241c	73e7e5ea-13eb-4509-bed7-441541ed1447	admin	2026-01-03 19:55:47.545+03	f	2026-01-03 19:55:04.315+03	2026-01-03 19:55:47.545+03
1dcff547-f24f-4371-bd41-f78bd7b20140	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	member	2026-01-03 20:02:39.998+03	f	2026-01-03 19:50:54.414+03	2026-01-03 20:02:39.998+03
d400d790-75ae-408b-8564-05f9a9a0c15d	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	73e7e5ea-13eb-4509-bed7-441541ed1447	admin	2026-01-03 20:00:46.066+03	f	2026-01-03 19:50:54.414+03	2026-01-03 20:00:46.067+03
\.


--
-- Data for Name: chats; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chats (id, name, type, avatar, "lastMessage", "lastMessageAt", "createdBy", "createdAt", "updatedAt") FROM stdin;
0f620089-d281-4837-853e-a9564fe1241c	\N	private	\N	Привет	2026-01-03 19:55:20.694+03	73e7e5ea-13eb-4509-bed7-441541ed1447	2026-01-03 19:55:04.274+03	2026-01-03 19:55:20.695+03
47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	Тестовый чат	group	\N	Нет	2026-01-03 20:02:37.599+03	73e7e5ea-13eb-4509-bed7-441541ed1447	2026-01-03 19:50:54.407+03	2026-01-03 20:02:37.599+03
\.


--
-- Data for Name: doctor_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.doctor_cards (id, "pageSlug", "fullName", specialty, experience, "profileUrl", photo, description, phones, "sortOrder", metadata, "createdAt", "updatedAt", "misUserId") FROM stdin;
746340bb-14a6-4356-bbc4-2c7a55eee570	stomatologi	Трушкова Надежда Владимировна	Неврология	21 год		\N	<p>Тестовый врач</p>	[]	4	{"tags": ["невролог"], "clinics": [1], "ageRange": "0+", "misUserId": "1792", "mobileNumber": "", "serviceTitles": ["Консультация врача-специалиста на дому ( г. Анапа)", "Прием (осмотр, консультация) врача-невролога первичный", "Прием (осмотр, консультация) врача-невролога повторный", "Ботулинотерапия - лечение гипергидроза с использованием лекарственного препарата Релатокс", "Ботулинотерапия - лечение хронической мигрени с использованием лекарственного препарата Релатокс", "Ботулинотерапия - лечение дистонии с гипертонусом жевательных мышц с использованием лекарственного препарата Релатокс", "Ботулинотерапия - лечение хронической мигрени с дистонией, гипертонусом жевательных мышц с использованием лекарственного препарата Релатокс", "Ботулинотерапия - блокада миофасциальных триггерных точек с использованием лекарственного препарата Релатокс", "Ботулинотерапия - введение лекарственного препарата Релатокс 1ед", "Введение лекарственных препаратов в область периферического нерва (внутримышечные, периартикулярные инъекции)", "Введение лекарственных препаратов в область периферического нерва с Дексаметазоном", "Введение лекарственных препаратов в область периферического нерва с Дексаметазоном (повышенной сложности)", "Введение лекарственных препаратов в область периферического нерва с Дипроспаном", "Введение лекарственных препаратов в область периферического нерва по Фарберу", "Подкожное введение лекарственных препаратов (плазмы обогащенной тромбоцитами 1 зона)", "Введение препарата Фреманезумаб (Аджови) 1 инъекция", "Телемедицинская консультация врача-невролога ", "Бонусная программа \\"Первый пациент\\""], "internalNumber": ""}	2026-01-03 19:46:36.05+03	2026-01-03 19:46:36.93+03	\N
7e3342c4-12bc-4586-8ea2-89ddba2a6c99	stomatologi	Кривоносова Галина Алексеевна		41 год		\N		[]	2	{"clinics": [1], "ageRange": "", "misUserId": "716", "mobileNumber": "", "internalNumber": ""}	2026-01-02 20:15:48.705+03	2026-01-02 20:15:48.705+03	\N
30670876-baee-419d-a96e-d581e46d4146	ginekologi	Кривова Юлия Владимировна	Стоматология детская, Стоматология общей практики, Стоматология терапевтическая	20 лет		\N		[]	2	{"clinics": [1], "ageRange": "", "misUserId": "847", "mobileNumber": "", "internalNumber": ""}	2026-01-03 14:43:34.118+03	2026-01-03 15:24:38.899+03	\N
ecb18119-31b3-44ed-a7ae-c50f3e7e0bc8	ginekologi	Кульченко Дмитрий Валерьевич	Аллергология и иммунология, Пульмонология	19 лет		\N	Проверка	[]	1	{"clinics": [3], "ageRange": "", "misUserId": "133", "mobileNumber": "", "internalNumber": ""}	2026-01-03 09:32:39.472+03	2026-01-03 15:25:21.476+03	\N
a665f7ab-4f9c-4ea9-8424-7003091dedbb	stomatologi	Сорокина Наталья Владимировна	Стоматология общей практики, Стоматология ортопедическая, Стоматология терапевтическая	14 лет		\N	<p>Тестовая заметка</p>	[]	3	{"tags": [], "clinics": [6], "ageRange": "", "misUserId": "226", "mobileNumber": "+79002862752", "internalNumber": ""}	2026-01-03 09:30:13.324+03	2026-01-03 19:16:35.27+03	\N
d53937c5-4712-43f8-a50b-492e5fbc25be	stomatologi	Кривова Юлия Владимировна	Стоматология	20 лет	https://wikipedia.org	\N	<p><strong>Тестовое описание</strong></p><p><em>Проверка</em></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><strong>Тестовое описание</strong></p><p><em>Проверка</em></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><strong>Тестовое описание</strong></p><p><em>Проверка</em></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p>	[]	1	{"tags": ["на дому", "УЗИ", "КТ"], "clinics": [5, 6], "ageRange": "0+", "misUserId": "847", "mobileNumber": "+79002862752", "internalNumber": ""}	2026-01-02 19:14:37.092+03	2026-01-03 19:19:19.07+03	\N
\.


--
-- Data for Name: folders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.folders (id, title, icon, "parentId", "sortOrder", description, "createdBy", "createdAt", "updatedAt") FROM stdin;
e2928484-6bbc-4f29-8016-ecf0df98d02f	Тестовая папка	folder	\N	1		73e7e5ea-13eb-4509-bed7-441541ed1447	2026-01-01 22:43:26.105+03	2026-01-01 22:43:26.105+03
\.


--
-- Data for Name: map_markers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.map_markers (id, lat, lng, title, description, color, media, category, "createdBy", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: media; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.media (id, filename, "originalName", "mimeType", size, path, "thumbnailPath", alt, description, "createdAt", "updatedAt", "uploadedBy") FROM stdin;
6534fbed-462c-413f-aafb-7966a239132f	9b124d8e-b061-4a96-8155-b7d86bafd485.webp	sampo-item_icon_avatar.webp	image/webp	91570	uploads/2026-01/9b124d8e-b061-4a96-8155-b7d86bafd485.webp	uploads/2026-01/thumbs/thumb_9b124d8e-b061-4a96-8155-b7d86bafd485.webp	\N	\N	2026-01-03 16:22:25.055+03	2026-01-03 16:22:25.055+03	73e7e5ea-13eb-4509-bed7-441541ed1447
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.messages (id, "chatId", "senderId", content, type, attachments, "isEdited", "replyToId", "createdAt", "updatedAt") FROM stdin;
44a02d30-0746-45a9-a36b-4a1a8d973d73	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	73e7e5ea-13eb-4509-bed7-441541ed1447	Администратор создал группу "Тестовый чат"	system	[]	f	\N	2026-01-03 19:50:54.422+03	2026-01-03 19:50:54.422+03
6d774772-1983-4352-9df4-d5c9bb185f00	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	73e7e5ea-13eb-4509-bed7-441541ed1447	Привет всем	text	[]	f	\N	2026-01-03 19:51:12.309+03	2026-01-03 19:51:12.309+03
ce417d1e-aeef-48a8-b653-c63ba310e9d1	0f620089-d281-4837-853e-a9564fe1241c	73e7e5ea-13eb-4509-bed7-441541ed1447	Привет	text	[]	f	\N	2026-01-03 19:55:20.613+03	2026-01-03 19:55:20.613+03
bf2dfcb6-9c64-4f47-9994-b7984c82aabc	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Привет	text	[]	f	\N	2026-01-03 19:55:39.501+03	2026-01-03 19:55:39.501+03
146443fe-1568-4b04-b958-68b504efb8a2	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Привет, получили уведомление?	text	[]	f	\N	2026-01-03 20:01:24.153+03	2026-01-03 20:01:24.153+03
fd187ec6-42de-48b5-9c9d-f51285825e17	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:05.012+03	2026-01-03 20:02:05.012+03
77139ded-0584-414b-a30e-13e123163bc6	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:07.968+03	2026-01-03 20:02:07.968+03
79476326-98d3-47c9-b86a-538b4c555e79	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:11.782+03	2026-01-03 20:02:11.782+03
eb614680-560f-4093-a7a0-88d9142c1dc1	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:15.031+03	2026-01-03 20:02:15.031+03
424bb263-e6ca-4f98-8b64-cc59416cd78d	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:17.915+03	2026-01-03 20:02:17.915+03
554e7864-d2a9-4042-bd28-24a303be16d1	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:20.687+03	2026-01-03 20:02:20.687+03
31635ced-76e3-4907-9f3c-a4c25a2a8b4c	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:23.479+03	2026-01-03 20:02:23.479+03
248045df-648a-4670-aaea-1eb410a0cfb8	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:26.292+03	2026-01-03 20:02:26.292+03
21d56ccc-b150-4b8a-82fd-aea756ad3bfe	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:29.227+03	2026-01-03 20:02:29.227+03
1b5add48-4045-4be7-b6a5-cfcc15929342	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:31.968+03	2026-01-03 20:02:31.968+03
b33217a9-1760-44ef-92c6-077bcc7a7b39	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:34.61+03	2026-01-03 20:02:34.61+03
e91a5068-1d3c-451f-95eb-564906beeb77	47dc2e29-49f0-45c0-b0bd-ba4a6dc7a7b9	476cbc64-17c4-461a-9a16-be5e24e6fcf0	Нет	text	[]	f	\N	2026-01-03 20:02:37.556+03	2026-01-03 20:02:37.556+03
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pages (id, slug, title, content, "contentType", description, keywords, "searchContent", icon, "folderId", "sortOrder", "isPublished", "isFavorite", "allowedRoles", "customCss", "customJs", metadata, "createdAt", "updatedAt", "createdBy", "updatedBy") FROM stdin;
ec24fe19-5a44-4a48-98cb-f284c016984a	welcome	Добро пожаловать в Alfa Wiki	\n        <h1>Добро пожаловать в Alfa Wiki</h1>\n        <p>Это база знаний вашего медицинского центра.</p>\n        <h2>Начало работы</h2>\n        <p>Используйте меню слева для навигации по разделам.</p>\n        <p>Для создания новых страниц перейдите в административную панель.</p>\n      	wysiwyg	Главная страница базы знаний	{главная,welcome,начало}	\N	\N	\N	0	t	f	{}	\N	\N	{}	2025-12-31 16:44:18.277+03	2025-12-31 16:44:18.277+03	73e7e5ea-13eb-4509-bed7-441541ed1447	\N
c23073d8-4444-494b-ae53-b70518027d06	accreditations	Аккредитации	<style>\n#accreditations-app {\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n  max-width: 100%;\n  margin: 0 auto;\n}\n\n/* Блок Telegram бота */\n.acc-bot-info {\n  display: flex;\n  align-items: center;\n  gap: 20px;\n  padding: 20px 24px;\n  background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%);\n  border: 1px solid #7dd3fc;\n  border-radius: 12px;\n  margin-bottom: 24px;\n}\n\n.acc-bot-qr {\n  width: 100px;\n  height: 100px;\n  background: #fff;\n  border-radius: 8px;\n  padding: 8px;\n  flex-shrink: 0;\n}\n\n.acc-bot-qr img {\n  width: 100%;\n  height: 100%;\n  display: block;\n  margin: 0;\n}\n\n.acc-bot-content {\n  flex: 1;\n}\n\n.acc-bot-title {\n  font-size: 16px;\n  font-weight: 600;\n  color: #0c4a6e;\n  margin-bottom: 6px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.acc-bot-title svg {\n  width: 20px;\n  height: 20px;\n  color: #0ea5e9;\n}\n\n.acc-bot-desc {\n  font-size: 14px;\n  color: #075985;\n  margin-bottom: 10px;\n  line-height: 1.4;\n}\n\n.acc-bot-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 16px;\n  background: #0ea5e9;\n  color: #fff !important;\n  text-decoration: none;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  transition: background 0.2s;\n}\n\n.acc-bot-link:hover,\n.acc-bot-link:visited {\n  background: #0284c7;\n  color: #fff !important;\n}\n\n.acc-stats {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\n  gap: 16px;\n  margin-bottom: 24px;\n}\n\n.acc-stat-card {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  padding: 20px;\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n  border: 1px solid #e5e7eb;\n}\n\n.acc-stat-icon {\n  width: 48px;\n  height: 48px;\n  border-radius: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n}\n\n.acc-stat-icon svg { width: 24px; height: 24px; }\n.acc-stat-icon.total { background: #e0f2fe; color: #0284c7; }\n.acc-stat-icon.danger { background: #fee2e2; color: #dc2626; }\n.acc-stat-icon.warning { background: #fef3c7; color: #d97706; }\n.acc-stat-icon.info { background: #dbeafe; color: #2563eb; }\n\n.acc-stat-info { display: flex; flex-direction: column; }\n.acc-stat-value { font-size: 28px; font-weight: 700; color: #1f2937; line-height: 1; }\n.acc-stat-label { font-size: 13px; color: #6b7280; margin-top: 4px; }\n\n.acc-toolbar {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 16px;\n  margin-bottom: 20px;\n  flex-wrap: wrap;\n}\n\n.acc-filters {\n  display: flex;\n  gap: 12px;\n  flex-wrap: wrap;\n  flex: 1;\n}\n\n.acc-filter-group { min-width: 180px; }\n\n.acc-input, .acc-select, .acc-textarea {\n  width: 100%;\n  padding: 10px 14px;\n  border: 1px solid #d1d5db;\n  border-radius: 8px;\n  font-size: 14px;\n  transition: border-color 0.2s, box-shadow 0.2s;\n  background: #fff;\n  color: #1f2937;\n  box-sizing: border-box;\n}\n\n.acc-input:focus, .acc-select:focus, .acc-textarea:focus {\n  outline: none;\n  border-color: #3b82f6;\n  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);\n}\n\n.acc-textarea { resize: vertical; min-height: 80px; }\n\n.acc-btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 18px;\n  border: none;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  cursor: pointer;\n  transition: all 0.2s;\n  white-space: nowrap;\n}\n\n.acc-btn svg { width: 18px; height: 18px; }\n\n.acc-btn-primary {\n  background: linear-gradient(135deg, #3b82f6, #2563eb);\n  color: #fff;\n}\n.acc-btn-primary:hover { background: linear-gradient(135deg, #2563eb, #1d4ed8); transform: translateY(-1px); }\n\n.acc-btn-secondary { background: #f3f4f6; color: #374151; }\n.acc-btn-secondary:hover { background: #e5e7eb; }\n\n.acc-btn-icon {\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  justify-content: center;\n  border-radius: 6px;\n}\n\n.acc-btn-edit { background: #dbeafe; color: #2563eb; }\n.acc-btn-edit:hover { background: #bfdbfe; }\n.acc-btn-delete { background: #fee2e2; color: #dc2626; }\n.acc-btn-delete:hover { background: #fecaca; }\n\n.acc-table-container {\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n  border: 1px solid #e5e7eb;\n  overflow-x: auto;\n  margin-top: 0;\n}\n\n.acc-table {\n  width: 100%;\n  border-collapse: collapse;\n  margin: 0 !important;\n}\n\n.acc-table th {\n  background: #f8fafc;\n  padding: 14px 16px;\n  text-align: center;\n  font-weight: 600;\n  font-size: 13px;\n  color: #4b5563;\n  border-bottom: 2px solid #e5e7eb;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  vertical-align: middle;\n}\n\n.acc-table th.sortable { cursor: pointer; user-select: none; }\n.acc-table th.sortable:hover { background: #f1f5f9; }\n.sort-icon { opacity: 0.4; margin-left: 4px; }\n.acc-table th.sorted .sort-icon { opacity: 1; color: #3b82f6; }\n\n.acc-table td {\n  padding: 14px 16px;\n  border-bottom: 1px solid #f1f5f9;\n  font-size: 14px;\n  color: #374151;\n  vertical-align: middle;\n}\n\n.acc-table tr:hover { background: #f8fafc; }\n.acc-table tr:last-child td { border-bottom: none; }\n\n/* Индикация дат - исправленные цвета */\n.acc-date { padding: 4px 10px; border-radius: 20px; font-size: 13px; font-weight: 500; display: inline-block; }\n.acc-date.expired { background: #fee2e2; color: #dc2626; }\n.acc-date.critical { background: #fef2f2; color: #b91c1c; }\n.acc-date.warning { background: #fef3c7; color: #b45309; }\n.acc-date.soon { background: #fef9c3; color: #a16207; }\n.acc-date.ok { background: #dcfce7; color: #16a34a; }\n\n.acc-actions { display: flex; gap: 6px; }\n\n.acc-loading, .acc-empty { text-align: center; padding: 40px !important; color: #9ca3af; }\n\n.acc-modal {\n  position: fixed;\n  inset: 0;\n  background: rgba(0,0,0,0.5);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 10000;\n  backdrop-filter: blur(4px);\n}\n\n.acc-modal-content {\n  background: #fff;\n  border-radius: 16px;\n  width: 100%;\n  max-width: 500px;\n  max-height: 90vh;\n  overflow-y: auto;\n  box-shadow: 0 20px 60px rgba(0,0,0,0.3);\n  margin: 16px;\n}\n\n.acc-modal-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 20px 24px;\n  border-bottom: 1px solid #e5e7eb;\n}\n\n.acc-modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; color: #1f2937; }\n\n.acc-modal-close {\n  width: 32px;\n  height: 32px;\n  border: none;\n  background: #f3f4f6;\n  border-radius: 8px;\n  font-size: 20px;\n  cursor: pointer;\n  color: #6b7280;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.acc-modal-close:hover { background: #e5e7eb; }\n\n#acc-form { padding: 24px; }\n\n.acc-form-group { margin-bottom: 18px; }\n.acc-form-group label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151; }\n\n.acc-modal-footer {\n  display: flex;\n  justify-content: flex-end;\n  gap: 12px;\n  padding-top: 16px;\n  border-top: 1px solid #e5e7eb;\n  margin-top: 8px;\n}\n\n.acc-toast {\n  position: fixed;\n  bottom: 24px;\n  right: 24px;\n  padding: 14px 20px;\n  background: #1f2937;\n  color: #fff;\n  border-radius: 10px;\n  font-size: 14px;\n  opacity: 0;\n  transform: translateY(20px);\n  transition: all 0.3s;\n  z-index: 10001;\n  box-shadow: 0 10px 30px rgba(0,0,0,0.2);\n}\n.acc-toast.show { opacity: 1; transform: translateY(0); }\n.acc-toast.success { background: #059669; }\n.acc-toast.error { background: #dc2626; }\n\n/* Пагинация */\n.acc-pagination {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 16px 20px;\n  background: #f8fafc;\n  border-top: 1px solid #e5e7eb;\n  gap: 16px;\n}\n\n.acc-pagination-info {\n  font-size: 14px;\n  color: #6b7280;\n}\n\n.acc-pagination-controls {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.acc-pagination-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 36px;\n  height: 36px;\n  padding: 0 12px;\n  border: 1px solid #d1d5db;\n  background: #fff;\n  border-radius: 8px;\n  font-size: 14px;\n  color: #374151;\n  cursor: pointer;\n  transition: all 0.2s;\n}\n\n.acc-pagination-btn:hover:not(:disabled) {\n  background: #f3f4f6;\n  border-color: #9ca3af;\n}\n\n.acc-pagination-btn:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n.acc-pagination-btn.active {\n  background: #3b82f6;\n  border-color: #3b82f6;\n  color: #fff;\n}\n\n.acc-pagination-btn svg {\n  width: 16px;\n  height: 16px;\n}\n\n/* Цвета медцентров - обновлённые */\n.acc-medcenter {\n  padding: 4px 10px;\n  border-radius: 6px;\n  font-size: 13px;\n  font-weight: 500;\n  display: inline-block;\n}\n.acc-medcenter[data-center="Альфа"] { background: #fce7f3; color: #be185d; }\n.acc-medcenter[data-center="Кидс"] { background: #ffedd5; color: #c2410c; }\n.acc-medcenter[data-center="Проф"] { background: #ede9fe; color: #6d28d9; }\n.acc-medcenter[data-center="3К"] { background: #fdf4ff; color: #a21caf; }\n.acc-medcenter[data-center="Смайл"] { background: #f3f4f6; color: #4b5563; }\n.acc-medcenter[data-center="Линия"] { background: #fef3c7; color: #92400e; }\n\n/* Подсветка найденной записи из поиска */\n.acc-highlight {\n  animation: highlightPulse 3s ease-out;\n}\n.acc-highlight td {\n  background: #fef3c7 !important;\n}\n@keyframes highlightPulse {\n  0%, 50% { background: #fde68a; }\n  100% { background: transparent; }\n}\n\n/* Планшеты */\n@media (max-width: 1024px) {\n  .acc-table th, .acc-table td { padding: 12px 10px; }\n  .acc-stats { grid-template-columns: repeat(2, 1fr); }\n}\n\n/* Мобильные устройства */\n@media (max-width: 768px) {\n  .acc-bot-info { \n    flex-direction: column; \n    text-align: center; \n    padding: 16px;\n    gap: 16px;\n  }\n  .acc-bot-qr { width: 120px; height: 120px; }\n  .acc-bot-desc { font-size: 13px; }\n  \n  .acc-stats { grid-template-columns: 1fr 1fr; gap: 10px; }\n  .acc-stat-card { padding: 14px 12px; gap: 12px; }\n  .acc-stat-icon { width: 40px; height: 40px; }\n  .acc-stat-icon svg { width: 20px; height: 20px; }\n  .acc-stat-value { font-size: 22px; }\n  .acc-stat-label { font-size: 11px; }\n  \n  .acc-toolbar { flex-direction: column; align-items: stretch; gap: 12px; }\n  .acc-filters { flex-direction: column; gap: 10px; }\n  .acc-filter-group { min-width: 100%; }\n  .acc-btn-primary { width: 100%; justify-content: center; }\n  \n  .acc-table-container { border-radius: 8px; }\n  .acc-table { font-size: 13px; }\n  .acc-table th { \n    padding: 10px 8px; \n    font-size: 11px;\n    letter-spacing: 0;\n  }\n  .acc-table td { padding: 10px 8px; }\n  \n  .acc-table th:nth-child(5),\n  .acc-table td:nth-child(5) { display: none; }\n  \n  .acc-medcenter, .acc-date { \n    padding: 3px 8px; \n    font-size: 11px; \n  }\n  \n  .acc-btn-icon { width: 28px; height: 28px; }\n  .acc-btn-icon svg { width: 14px; height: 14px; }\n  \n  .acc-modal-content { \n    margin: 8px; \n    max-height: calc(100vh - 16px);\n    border-radius: 12px;\n  }\n  .acc-modal-header { padding: 16px; }\n  .acc-modal-header h3 { font-size: 16px; }\n  #acc-form { padding: 16px; }\n  .acc-form-group { margin-bottom: 14px; }\n  .acc-input, .acc-select, .acc-textarea { padding: 12px; font-size: 16px; }\n  \n  .acc-toast { \n    left: 16px; \n    right: 16px; \n    bottom: 16px; \n    text-align: center;\n  }\n  \n  .acc-pagination { flex-wrap: wrap; justify-content: center; }\n}\n\n/* Маленькие мобильные */\n@media (max-width: 480px) {\n  .acc-stats { grid-template-columns: 1fr; gap: 8px; }\n  .acc-stat-card { \n    flex-direction: row; \n    justify-content: flex-start;\n    padding: 12px 16px;\n  }\n  \n  .acc-table th:nth-child(3),\n  .acc-table td:nth-child(3) { display: none; }\n  \n  .acc-table th:first-child,\n  .acc-table td:first-child { \n    max-width: 70px;\n  }\n  \n  .acc-medcenter {\n    max-width: 60px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n  \n  .acc-bot-qr { width: 100px; height: 100px; }\n  .acc-bot-link { \n    width: 100%; \n    justify-content: center;\n    padding: 10px 16px;\n  }\n  \n  .acc-pagination { \n    flex-direction: column; \n    gap: 12px;\n    padding: 12px 16px;\n  }\n  .acc-pagination-info { text-align: center; }\n  .acc-pagination-btn { min-width: 32px; height: 32px; padding: 0 8px; font-size: 13px; }\n}\n</style>\n\n<div id="accreditations-app">\n  <!-- Блок с информацией о Telegram боте -->\n  <div class="acc-bot-info">\n    <div class="acc-bot-qr">\n      <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://t.me/alfa_appointments_bot" alt="QR код бота">\n    </div>\n    <div class="acc-bot-content">\n      <div class="acc-bot-title">\n        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>\n        Telegram-бот напоминаний\n      </div>\n      <div class="acc-bot-desc">\n        Подпишитесь на бота, чтобы получать уведомления об истечении сроков аккредитаций за 90, 60, 30, 14 и 7 дней.\n      </div>\n      <a href="https://t.me/alfa_appointments_bot" target="_blank" class="acc-bot-link">\n        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>\n        @alfa_appointments_bot\n      </a>\n    </div>\n  </div>\n\n  <div class="acc-stats">\n    <div class="acc-stat-card">\n      <div class="acc-stat-icon total"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-total">0</span><span class="acc-stat-label">Всего</span></div>\n    </div>\n    <div class="acc-stat-card danger">\n      <div class="acc-stat-icon danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-expired">0</span><span class="acc-stat-label">Просрочено</span></div>\n    </div>\n    <div class="acc-stat-card warning">\n      <div class="acc-stat-icon warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-soon">0</span><span class="acc-stat-label">Истекает ≤30 дней</span></div>\n    </div>\n    <div class="acc-stat-card info">\n      <div class="acc-stat-icon info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-90">0</span><span class="acc-stat-label">Истекает ≤90 дней</span></div>\n    </div>\n  </div>\n\n  <div class="acc-toolbar">\n    <div class="acc-filters">\n      <div class="acc-filter-group">\n        <input type="text" id="filter-search" placeholder="🔍 Поиск по ФИО..." class="acc-input" oninput="accApp.debounceLoad()">\n      </div>\n      <div class="acc-filter-group">\n        <select id="filter-medcenter" class="acc-select" onchange="accApp.resetAndLoad()">\n          <option value="">Все медцентры</option>\n          <option value="Альфа">Альфа</option>\n          <option value="Кидс">Кидс</option>\n          <option value="Проф">Проф</option>\n          <option value="Линия">Линия</option>\n          <option value="Смайл">Смайл</option>\n          <option value="3К">3К</option>\n        </select>\n      </div>\n      <div class="acc-filter-group">\n        <select id="filter-specialty" class="acc-select" onchange="accApp.resetAndLoad()">\n          <option value="">Все специальности</option>\n        </select>\n      </div>\n    </div>\n    <button class="acc-btn acc-btn-primary" onclick="accApp.openAddModal()">\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\n      Добавить\n    </button>\n  </div>\n\n  <div class="acc-table-container">\n    <table class="acc-table">\n      <thead>\n        <tr>\n          <th class="sortable" onclick="accApp.sortTable('medCenter')">Медцентр <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="accApp.sortTable('fullName')">ФИО <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="accApp.sortTable('specialty')">Специальность <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="accApp.sortTable('expirationDate')">Срок действия <span class="sort-icon">↕</span></th>\n          <th>Комментарий</th>\n          <th style="text-align:center">Действия</th>\n        </tr>\n      </thead>\n      <tbody id="acc-table-body">\n        <tr><td colspan="6" class="acc-loading">Загрузка...</td></tr>\n      </tbody>\n    </table>\n    <div class="acc-pagination" id="acc-pagination" style="display:none">\n      <div class="acc-pagination-info" id="pagination-info">Показано 1-20 из 100</div>\n      <div class="acc-pagination-controls" id="pagination-controls"></div>\n    </div>\n  </div>\n\n  <div id="acc-modal" class="acc-modal" style="display:none" onclick="if(event.target===this)accApp.closeModal()">\n    <div class="acc-modal-content">\n      <div class="acc-modal-header">\n        <h3 id="modal-title">Добавить запись</h3>\n        <button class="acc-modal-close" onclick="accApp.closeModal()">&times;</button>\n      </div>\n      <form id="acc-form" onsubmit="accApp.saveRecord(event)">\n        <input type="hidden" id="edit-id">\n        <div class="acc-form-group">\n          <label>Медцентр *</label>\n          <select id="edit-medcenter" required class="acc-select">\n            <option value="">Выберите...</option>\n            <option value="Альфа">Альфа</option>\n            <option value="Кидс">Кидс</option>\n            <option value="Проф">Проф</option>\n            <option value="Линия">Линия</option>\n            <option value="Смайл">Смайл</option>\n            <option value="3К">3К</option>\n          </select>\n        </div>\n        <div class="acc-form-group">\n          <label>ФИО *</label>\n          <input type="text" id="edit-fullname" required class="acc-input" placeholder="Иванов Иван Иванович">\n        </div>\n        <div class="acc-form-group">\n          <label>Специальность *</label>\n          <input type="text" id="edit-specialty" required class="acc-input" placeholder="Терапия" list="specialties-list">\n          <datalist id="specialties-list"></datalist>\n        </div>\n        <div class="acc-form-group">\n          <label>Срок действия *</label>\n          <input type="date" id="edit-expdate" required class="acc-input">\n        </div>\n        <div class="acc-form-group">\n          <label>Комментарий</label>\n          <textarea id="edit-comment" class="acc-textarea" rows="3" placeholder="Дополнительная информация..."></textarea>\n        </div>\n        <div class="acc-modal-footer">\n          <button type="button" class="acc-btn acc-btn-secondary" onclick="accApp.closeModal()">Отмена</button>\n          <button type="submit" class="acc-btn acc-btn-primary">Сохранить</button>\n        </div>\n      </form>\n    </div>\n  </div>\n\n  <div id="acc-toast" class="acc-toast"></div>\n</div>\n\n<script>\nwindow.accApp = (function() {\n  var API_URL = window.location.protocol + '//' + window.location.hostname + ':9001/api/accreditations';\n  var accreditations = [];\n  var sortField = 'expirationDate';\n  var sortOrder = 'ASC';\n  var debounceTimer = null;\n  var currentPage = 1;\n  var pageSize = 20;\n  var highlightId = null;\n\n  function getToken() {\n    return localStorage.getItem('token');\n  }\n\n  function fetchAPI(url, options) {\n    options = options || {};\n    return fetch(url, {\n      method: options.method || 'GET',\n      headers: {\n        'Content-Type': 'application/json',\n        'Authorization': 'Bearer ' + getToken()\n      },\n      body: options.body\n    }).then(function(r) {\n      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Error'); });\n      return r.json();\n    });\n  }\n\n  function showToast(msg, type) {\n    var t = document.getElementById('acc-toast');\n    t.textContent = msg;\n    t.className = 'acc-toast show ' + (type || '');\n    setTimeout(function() { t.className = 'acc-toast'; }, 3000);\n  }\n\n  function escapeHtml(s) {\n    if (!s) return '';\n    var d = document.createElement('div');\n    d.textContent = s;\n    return d.innerHTML;\n  }\n\n  function formatDate(ds) {\n    var d = new Date(ds);\n    return ('0'+d.getDate()).slice(-2) + '.' + ('0'+(d.getMonth()+1)).slice(-2) + '.' + d.getFullYear();\n  }\n\n  function getDateClass(ds) {\n    var diff = Math.ceil((new Date(ds) - new Date().setHours(0,0,0,0)) / 86400000);\n    if (diff < 0) return 'expired';\n    if (diff <= 7) return 'critical';\n    if (diff <= 30) return 'warning';\n    if (diff <= 90) return 'soon';\n    return 'ok';\n  }\n\n  function loadData() {\n    var search = document.getElementById('filter-search').value;\n    var mc = document.getElementById('filter-medcenter').value;\n    var sp = document.getElementById('filter-specialty').value;\n    \n    var url = API_URL + '?sortBy=' + sortField + '&sortOrder=' + sortOrder;\n    if (search) url += '&search=' + encodeURIComponent(search);\n    if (mc) url += '&medCenter=' + encodeURIComponent(mc);\n    if (sp) url += '&specialty=' + encodeURIComponent(sp);\n\n    fetchAPI(url).then(function(data) {\n      accreditations = data;\n      if (currentPage > Math.ceil(accreditations.length / pageSize)) {\n        currentPage = 1;\n      }\n      renderTable();\n      renderPagination();\n      loadStats();\n    }).catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function loadStats() {\n    fetchAPI(API_URL + '/stats').then(function(s) {\n      document.getElementById('stat-total').textContent = s.total;\n      document.getElementById('stat-expired').textContent = s.expired;\n      document.getElementById('stat-soon').textContent = s.expiringSoon;\n      document.getElementById('stat-90').textContent = s.expiringIn90;\n    });\n  }\n\n  function loadSpecialties() {\n    fetchAPI(API_URL + '/specialties').then(function(list) {\n      var sel = document.getElementById('filter-specialty');\n      var dl = document.getElementById('specialties-list');\n      sel.innerHTML = '<option value="">Все специальности</option>' + list.map(function(s) {\n        return '<option value="'+s+'">'+s+'</option>';\n      }).join('');\n      dl.innerHTML = list.map(function(s) { return '<option value="'+s+'">'; }).join('');\n    });\n  }\n\n  function renderTable() {\n    var tb = document.getElementById('acc-table-body');\n    if (!accreditations.length) {\n      tb.innerHTML = '<tr><td colspan="6" class="acc-empty">Нет данных</td></tr>';\n      return;\n    }\n    var start = (currentPage - 1) * pageSize;\n    var end = start + pageSize;\n    var pageData = accreditations.slice(start, end);\n    \n    tb.innerHTML = pageData.map(function(a) {\n      var isHighlighted = highlightId && a.id === highlightId;\n      return '<tr data-id="' + a.id + '"' + (isHighlighted ? ' class="acc-highlight"' : '') + '>' +\n        '<td><span class="acc-medcenter" data-center="'+a.medCenter+'">'+a.medCenter+'</span></td>' +\n        '<td><strong>'+escapeHtml(a.fullName)+'</strong></td>' +\n        '<td>'+escapeHtml(a.specialty)+'</td>' +\n        '<td><span class="acc-date '+getDateClass(a.expirationDate)+'">'+formatDate(a.expirationDate)+'</span></td>' +\n        '<td>'+escapeHtml(a.comment||'—')+'</td>' +\n        '<td style="text-align:center"><div class="acc-actions" style="justify-content:center">' +\n          '<button class="acc-btn acc-btn-icon acc-btn-edit" onclick="accApp.openEditModal(\\''+a.id+'\\')" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +\n          '<button class="acc-btn acc-btn-icon acc-btn-delete" onclick="accApp.deleteRecord(\\''+a.id+'\\')" title="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +\n        '</div></td></tr>';\n    }).join('');\n\n    if (highlightId) {\n      setTimeout(function() { highlightId = null; }, 3000);\n    }\n  }\n\n  function renderPagination() {\n    var pagination = document.getElementById('acc-pagination');\n    var info = document.getElementById('pagination-info');\n    var controls = document.getElementById('pagination-controls');\n    var total = accreditations.length;\n    var totalPages = Math.ceil(total / pageSize);\n    \n    if (total <= pageSize) {\n      pagination.style.display = 'none';\n      return;\n    }\n    \n    pagination.style.display = 'flex';\n    \n    var start = (currentPage - 1) * pageSize + 1;\n    var end = Math.min(currentPage * pageSize, total);\n    info.textContent = 'Показано ' + start + '-' + end + ' из ' + total;\n    \n    var html = '';\n    html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';\n    \n    var startPage = Math.max(1, currentPage - 2);\n    var endPage = Math.min(totalPages, startPage + 4);\n    if (endPage - startPage < 4) {\n      startPage = Math.max(1, endPage - 4);\n    }\n    \n    if (startPage > 1) {\n      html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(1)">1</button>';\n      if (startPage > 2) html += '<span style="color:#9ca3af">...</span>';\n    }\n    \n    for (var i = startPage; i <= endPage; i++) {\n      html += '<button class="acc-pagination-btn ' + (i === currentPage ? 'active' : '') + '" onclick="accApp.goToPage(' + i + ')">' + i + '</button>';\n    }\n    \n    if (endPage < totalPages) {\n      if (endPage < totalPages - 1) html += '<span style="color:#9ca3af">...</span>';\n      html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(' + totalPages + ')">' + totalPages + '</button>';\n    }\n    \n    html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>';\n    \n    controls.innerHTML = html;\n  }\n\n  function goToPage(page) {\n    var totalPages = Math.ceil(accreditations.length / pageSize);\n    if (page < 1 || page > totalPages) return;\n    currentPage = page;\n    renderTable();\n    renderPagination();\n    document.querySelector('.acc-table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });\n  }\n\n  function scrollToRecord(id) {\n    var index = -1;\n    for (var i = 0; i < accreditations.length; i++) {\n      if (accreditations[i].id === id) { index = i; break; }\n    }\n    if (index === -1) return false;\n    \n    highlightId = id;\n    currentPage = Math.floor(index / pageSize) + 1;\n    renderTable();\n    renderPagination();\n    \n    setTimeout(function() {\n      var row = document.querySelector('tr[data-id="' + id + '"]');\n      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });\n    }, 100);\n    return true;\n  }\n\n  function openAddModal() {\n    document.getElementById('modal-title').textContent = 'Добавить запись';\n    document.getElementById('edit-id').value = '';\n    document.getElementById('acc-form').reset();\n    document.getElementById('acc-modal').style.display = 'flex';\n  }\n\n  function openEditModal(id) {\n    var a = accreditations.find(function(x) { return x.id === id; });\n    if (!a) return;\n    document.getElementById('modal-title').textContent = 'Редактировать';\n    document.getElementById('edit-id').value = a.id;\n    document.getElementById('edit-medcenter').value = a.medCenter;\n    document.getElementById('edit-fullname').value = a.fullName;\n    document.getElementById('edit-specialty').value = a.specialty;\n    document.getElementById('edit-expdate').value = a.expirationDate;\n    document.getElementById('edit-comment').value = a.comment || '';\n    document.getElementById('acc-modal').style.display = 'flex';\n  }\n\n  function closeModal() {\n    document.getElementById('acc-modal').style.display = 'none';\n  }\n\n  function saveRecord(e) {\n    e.preventDefault();\n    var id = document.getElementById('edit-id').value;\n    var data = {\n      medCenter: document.getElementById('edit-medcenter').value,\n      fullName: document.getElementById('edit-fullname').value,\n      specialty: document.getElementById('edit-specialty').value,\n      expirationDate: document.getElementById('edit-expdate').value,\n      comment: document.getElementById('edit-comment').value\n    };\n    var url = id ? API_URL + '/' + id : API_URL;\n    fetchAPI(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })\n      .then(function() {\n        showToast(id ? 'Обновлено' : 'Добавлено', 'success');\n        closeModal();\n        loadData();\n        loadSpecialties();\n      }).catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function deleteRecord(id) {\n    if (!confirm('Удалить запись?')) return;\n    fetchAPI(API_URL + '/' + id, { method: 'DELETE' })\n      .then(function() {\n        showToast('Удалено', 'success');\n        loadData();\n        loadSpecialties();\n      }).catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function sortTable(field) {\n    if (sortField === field) {\n      sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';\n    } else {\n      sortField = field;\n      sortOrder = 'ASC';\n    }\n    currentPage = 1;\n    loadData();\n  }\n\n  function debounceLoad() {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(function() {\n      currentPage = 1;\n      loadData();\n    }, 300);\n  }\n\n  function resetAndLoad() {\n    currentPage = 1;\n    loadData();\n  }\n\n  // Init\n  if (!getToken()) {\n    document.getElementById('accreditations-app').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">Необходима авторизация</div>';\n  } else {\n    var urlParams = new URLSearchParams(window.location.search);\n    var highlightParam = urlParams.get('highlight');\n    \n    loadData();\n    loadSpecialties();\n    \n    if (highlightParam) {\n      var checkAndScroll = setInterval(function() {\n        if (accreditations.length > 0) {\n          clearInterval(checkAndScroll);\n          scrollToRecord(highlightParam);\n          window.history.replaceState({}, '', window.location.pathname);\n        }\n      }, 100);\n      setTimeout(function() { clearInterval(checkAndScroll); }, 5000);\n    }\n    \n    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });\n  }\n\n  return {\n    loadData: loadData,\n    openAddModal: openAddModal,\n    openEditModal: openEditModal,\n    closeModal: closeModal,\n    saveRecord: saveRecord,\n    deleteRecord: deleteRecord,\n    sortTable: sortTable,\n    debounceLoad: debounceLoad,\n    resetAndLoad: resetAndLoad,\n    goToPage: goToPage,\n    scrollToRecord: scrollToRecord\n  };\n})();\n</script>	html		{}	Telegram-бот напоминаний Подпишитесь на бота, чтобы получать уведомления об истечении сроков аккредитаций за 90, 60, 30, 14 и 7 дней. @alfa_appointments_bot 0Всего 0Просрочено 0Истекает ≤30 дней 0Истекает ≤90 дней Добавить Медцентр ↕ ФИО ↕ Специальность ↕ Срок действия ↕ Комментарий Действия Загрузка... Показано 1-20 из 100 Добавить запись × Медцентр * ФИО * Специальность * Срок действия * Комментарий Отмена Сохранить	file-text	e2928484-6bbc-4f29-8016-ecf0df98d02f	1	f	f	{}			{}	2026-01-01 22:43:41.638+03	2026-01-01 22:45:29.324+03	73e7e5ea-13eb-4509-bed7-441541ed1447	73e7e5ea-13eb-4509-bed7-441541ed1447
55ea4bca-aa45-4d04-b676-948a90a50d01	vehicles	Техобслуживание	<style>\n#vehicles-app {\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n  max-width: 100%;\n  margin: 0 auto;\n}\n\n/* Блок Telegram бота */\n.veh-bot-info {\n  display: flex;\n  align-items: center;\n  gap: 20px;\n  padding: 20px 24px;\n  background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%);\n  border: 1px solid #7dd3fc;\n  border-radius: 12px;\n  margin-bottom: 24px;\n}\n\n.veh-bot-qr {\n  width: 100px;\n  height: 100px;\n  background: #fff;\n  border-radius: 8px;\n  padding: 8px;\n  flex-shrink: 0;\n}\n\n.veh-bot-qr img {\n  width: 100%;\n  height: 100%;\n  display: block;\n  margin: 0;\n}\n\n.veh-bot-content {\n  flex: 1;\n}\n\n.veh-bot-title {\n  font-size: 16px;\n  font-weight: 600;\n  color: #0c4a6e;\n  margin-bottom: 6px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.veh-bot-title svg {\n  width: 20px;\n  height: 20px;\n  color: #0ea5e9;\n}\n\n.veh-bot-desc {\n  font-size: 14px;\n  color: #075985;\n  margin-bottom: 10px;\n  line-height: 1.4;\n}\n\n.veh-bot-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 16px;\n  background: #0ea5e9;\n  color: #fff !important;\n  text-decoration: none;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  transition: background 0.2s;\n}\n\n.veh-bot-link:hover,\n.veh-bot-link:visited {\n  background: #0284c7;\n  color: #fff !important;\n}\n\n.veh-stats {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\n  gap: 16px;\n  margin-bottom: 24px;\n}\n\n.veh-stat-card {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  padding: 20px;\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n  border: 1px solid #e5e7eb;\n}\n\n.veh-stat-icon {\n  width: 48px;\n  height: 48px;\n  border-radius: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n}\n\n.veh-stat-icon svg { width: 24px; height: 24px; }\n.veh-stat-icon.total { background: #e0f2fe; color: #0284c7; }\n.veh-stat-icon.danger { background: #fee2e2; color: #dc2626; }\n.veh-stat-icon.warning { background: #fef3c7; color: #d97706; }\n.veh-stat-icon.info { background: #dbeafe; color: #2563eb; }\n\n.veh-stat-info { display: flex; flex-direction: column; }\n.veh-stat-value { font-size: 28px; font-weight: 700; color: #111827; line-height: 1.2; }\n.veh-stat-label { font-size: 13px; color: #6b7280; margin-top: 2px; }\n\n/* Тулбар и фильтры */\n.veh-toolbar {\n  display: flex;\n  justify-content: space-between;\n  align-items: flex-start;\n  gap: 16px;\n  margin-bottom: 20px;\n  flex-wrap: wrap;\n}\n\n.veh-filters {\n  display: flex;\n  gap: 12px;\n  flex-wrap: wrap;\n  flex: 1;\n}\n\n.veh-filter-group {\n  min-width: 180px;\n}\n\n.veh-input {\n  width: 100%;\n  padding: 10px 14px;\n  border: 1px solid #d1d5db;\n  border-radius: 8px;\n  font-size: 14px;\n  transition: border-color 0.2s, box-shadow 0.2s;\n  box-sizing: border-box;\n}\n\n.veh-input:focus {\n  outline: none;\n  border-color: #3b82f6;\n  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);\n}\n\n.veh-select {\n  width: 100%;\n  padding: 10px 14px;\n  border: 1px solid #d1d5db;\n  border-radius: 8px;\n  font-size: 14px;\n  background: #fff;\n  cursor: pointer;\n}\n\n.veh-select:focus {\n  outline: none;\n  border-color: #3b82f6;\n  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);\n}\n\n.veh-btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 10px 18px;\n  border: none;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  cursor: pointer;\n  transition: all 0.2s;\n  white-space: nowrap;\n}\n\n.veh-btn svg { width: 18px; height: 18px; }\n\n.veh-btn-primary {\n  background: #3b82f6;\n  color: #fff;\n}\n\n.veh-btn-primary:hover { background: #2563eb; }\n\n.veh-btn-secondary {\n  background: #f3f4f6;\n  color: #374151;\n  border: 1px solid #d1d5db;\n}\n\n.veh-btn-secondary:hover { background: #e5e7eb; }\n\n/* Кнопки действий в таблице */\n.veh-btn-icon {\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  border: none;\n  border-radius: 6px;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  transition: all 0.2s;\n}\n\n.veh-btn-icon svg { width: 16px; height: 16px; }\n\n.veh-btn-icon.edit {\n  background: #dbeafe;\n  color: #2563eb;\n}\n.veh-btn-icon.edit:hover { background: #bfdbfe; }\n\n.veh-btn-icon.delete {\n  background: #fee2e2;\n  color: #dc2626;\n}\n.veh-btn-icon.delete:hover { background: #fecaca; }\n\n/* Таблица */\n.veh-table-container {\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n  border: 1px solid #e5e7eb;\n  overflow: hidden;\n}\n\n.veh-table {\n  width: 100%;\n  border-collapse: collapse;\n}\n\n.veh-table th {\n  padding: 14px 16px;\n  text-align: left;\n  background: #f8fafc;\n  font-weight: 600;\n  font-size: 13px;\n  color: #4b5563;\n  border-bottom: 2px solid #e5e7eb;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  vertical-align: middle;\n}\n\n.veh-table th.sortable { cursor: pointer; user-select: none; }\n.veh-table th.sortable:hover { background: #f1f5f9; }\n.sort-icon { opacity: 0.4; margin-left: 4px; }\n.veh-table th.sorted .sort-icon { opacity: 1; color: #3b82f6; }\n\n.veh-table td {\n  padding: 14px 16px;\n  border-bottom: 1px solid #f1f5f9;\n  font-size: 14px;\n  color: #374151;\n  vertical-align: middle;\n}\n\n.veh-table tr:hover { background: #f8fafc; }\n.veh-table tr:last-child td { border-bottom: none; }\n\n/* Индикация - организация */\n.veh-organization {\n  padding: 4px 10px;\n  border-radius: 6px;\n  font-size: 13px;\n  font-weight: 500;\n  display: inline-block;\n  background: #e0f2fe;\n  color: #0369a1;\n}\n\n/* Индикация дат и пробега */\n.veh-date, .veh-mileage { \n  padding: 4px 10px; \n  border-radius: 20px; \n  font-size: 13px; \n  font-weight: 500; \n  display: inline-block; \n}\n.veh-date.expired, .veh-mileage.expired { background: #fee2e2; color: #dc2626; }\n.veh-date.critical, .veh-mileage.critical { background: #fef2f2; color: #b91c1c; }\n.veh-date.warning, .veh-mileage.warning { background: #fef3c7; color: #b45309; }\n.veh-date.soon, .veh-mileage.soon { background: #fef9c3; color: #a16207; }\n.veh-date.ok, .veh-mileage.ok { background: #dcfce7; color: #16a34a; }\n\n/* Состояние */\n.veh-condition {\n  padding: 4px 10px;\n  border-radius: 6px;\n  font-size: 13px;\n  font-weight: 500;\n  display: inline-block;\n}\n.veh-condition.good { background: #dcfce7; color: #16a34a; }\n.veh-condition.satisfactory { background: #fef3c7; color: #b45309; }\n.veh-condition.poor { background: #fee2e2; color: #dc2626; }\n\n.veh-actions { display: flex; gap: 6px; }\n\n.veh-loading, .veh-empty { text-align: center; padding: 40px !important; color: #9ca3af; }\n\n/* Модальное окно */\n.veh-modal {\n  position: fixed;\n  inset: 0;\n  background: rgba(0,0,0,0.5);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 10000;\n  backdrop-filter: blur(4px);\n}\n\n.veh-modal-content {\n  background: #fff;\n  border-radius: 16px;\n  width: 100%;\n  max-width: 580px;\n  max-height: 90vh;\n  overflow-y: auto;\n  box-shadow: 0 20px 60px rgba(0,0,0,0.3);\n  margin: 16px;\n}\n\n.veh-modal-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 20px 24px;\n  border-bottom: 1px solid #e5e7eb;\n}\n\n.veh-modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; color: #1f2937; }\n\n.veh-modal-close {\n  width: 32px;\n  height: 32px;\n  border: none;\n  background: #f3f4f6;\n  border-radius: 8px;\n  font-size: 20px;\n  cursor: pointer;\n  color: #6b7280;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.veh-modal-close:hover { background: #e5e7eb; }\n\n#veh-form { padding: 24px; }\n\n.veh-form-row {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 16px;\n}\n\n.veh-form-group { margin-bottom: 18px; }\n.veh-form-group label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151; }\n.veh-form-group.full-width { grid-column: 1 / -1; }\n\n.veh-textarea {\n  width: 100%;\n  padding: 10px 14px;\n  border: 1px solid #d1d5db;\n  border-radius: 8px;\n  font-size: 14px;\n  resize: vertical;\n  min-height: 80px;\n  box-sizing: border-box;\n}\n\n.veh-textarea:focus {\n  outline: none;\n  border-color: #3b82f6;\n  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);\n}\n\n.veh-modal-footer {\n  display: flex;\n  justify-content: flex-end;\n  gap: 12px;\n  padding-top: 16px;\n  border-top: 1px solid #e5e7eb;\n  margin-top: 8px;\n}\n\n/* Toast */\n.veh-toast {\n  position: fixed;\n  bottom: 24px;\n  right: 24px;\n  padding: 14px 20px;\n  background: #1f2937;\n  color: #fff;\n  border-radius: 10px;\n  font-size: 14px;\n  opacity: 0;\n  transform: translateY(20px);\n  transition: all 0.3s;\n  z-index: 10001;\n  box-shadow: 0 10px 30px rgba(0,0,0,0.2);\n}\n.veh-toast.show { opacity: 1; transform: translateY(0); }\n.veh-toast.success { background: #059669; }\n.veh-toast.error { background: #dc2626; }\n\n/* Пагинация */\n.veh-pagination {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 16px 20px;\n  background: #f8fafc;\n  border-top: 1px solid #e5e7eb;\n  gap: 16px;\n}\n\n.veh-pagination-info {\n  font-size: 14px;\n  color: #6b7280;\n}\n\n.veh-pagination-controls {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.veh-pagination-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 36px;\n  height: 36px;\n  padding: 0 12px;\n  border: 1px solid #d1d5db;\n  background: #fff;\n  border-radius: 8px;\n  font-size: 14px;\n  color: #374151;\n  cursor: pointer;\n  transition: all 0.2s;\n}\n\n.veh-pagination-btn:hover:not(:disabled) {\n  background: #f3f4f6;\n  border-color: #9ca3af;\n}\n\n.veh-pagination-btn:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n.veh-pagination-btn.active {\n  background: #3b82f6;\n  border-color: #3b82f6;\n  color: #fff;\n}\n\n.veh-pagination-btn svg {\n  width: 16px;\n  height: 16px;\n}\n\n/* Подсветка найденной записи из поиска */\n.veh-highlight {\n  animation: highlightPulse 3s ease-out;\n}\n.veh-highlight td {\n  background: #fef3c7 !important;\n}\n@keyframes highlightPulse {\n  0%, 50% { background: #fde68a; }\n  100% { background: transparent; }\n}\n\n/* Планшеты */\n@media (max-width: 1024px) {\n  .veh-table th, .veh-table td { padding: 12px 10px; }\n  .veh-stats { grid-template-columns: repeat(2, 1fr); }\n}\n\n/* Мобильные устройства */\n@media (max-width: 768px) {\n  .veh-bot-info { \n    flex-direction: column; \n    text-align: center; \n    padding: 16px;\n    gap: 16px;\n  }\n  .veh-bot-qr { width: 120px; height: 120px; }\n  .veh-bot-desc { font-size: 13px; }\n  \n  .veh-stats { grid-template-columns: 1fr 1fr; gap: 10px; }\n  .veh-stat-card { padding: 14px 12px; gap: 12px; }\n  .veh-stat-icon { width: 40px; height: 40px; }\n  .veh-stat-icon svg { width: 20px; height: 20px; }\n  .veh-stat-value { font-size: 22px; }\n  .veh-stat-label { font-size: 11px; }\n  \n  .veh-toolbar { flex-direction: column; align-items: stretch; gap: 12px; }\n  .veh-filters { flex-direction: column; gap: 10px; }\n  .veh-filter-group { min-width: 100%; }\n  .veh-btn-primary { width: 100%; justify-content: center; }\n  \n  .veh-table-container { border-radius: 8px; }\n  .veh-table { font-size: 13px; }\n  .veh-table th { \n    padding: 10px 8px; \n    font-size: 11px;\n    letter-spacing: 0;\n  }\n  .veh-table td { padding: 10px 8px; }\n  \n  .veh-table th:nth-child(5),\n  .veh-table td:nth-child(5) { display: none; }\n  \n  .veh-organization, .veh-date, .veh-mileage, .veh-condition { \n    padding: 3px 8px; \n    font-size: 11px; \n  }\n  \n  .veh-btn-icon { width: 28px; height: 28px; }\n  .veh-btn-icon svg { width: 14px; height: 14px; }\n  \n  .veh-modal-content { \n    margin: 8px; \n    max-height: calc(100vh - 16px);\n    border-radius: 12px;\n  }\n  .veh-modal-header { padding: 16px; }\n  .veh-modal-header h3 { font-size: 16px; }\n  #veh-form { padding: 16px; }\n  .veh-form-group { margin-bottom: 14px; }\n  .veh-form-row { grid-template-columns: 1fr; }\n  .veh-input, .veh-select, .veh-textarea { padding: 12px; font-size: 16px; }\n  \n  .veh-toast { \n    left: 16px; \n    right: 16px; \n    bottom: 16px; \n    text-align: center;\n  }\n  \n  .veh-pagination { flex-wrap: wrap; justify-content: center; }\n}\n\n/* Маленькие мобильные */\n@media (max-width: 480px) {\n  .veh-stats { grid-template-columns: 1fr; gap: 8px; }\n  .veh-stat-card { \n    flex-direction: row; \n    justify-content: flex-start;\n    padding: 12px 16px;\n  }\n  \n  .veh-table th:nth-child(4),\n  .veh-table td:nth-child(4) { display: none; }\n  \n  .veh-bot-qr { width: 100px; height: 100px; }\n  .veh-bot-link { \n    width: 100%; \n    justify-content: center;\n    padding: 10px 16px;\n  }\n  \n  .veh-pagination { \n    flex-direction: column; \n    gap: 12px;\n    padding: 12px 16px;\n  }\n  .veh-pagination-info { text-align: center; }\n  .veh-pagination-btn { min-width: 32px; height: 32px; padding: 0 8px; font-size: 13px; }\n}\n</style>\n\n<div id="vehicles-app">\n  <!-- Блок с информацией о Telegram боте -->\n  <div class="veh-bot-info">\n    <div class="veh-bot-qr">\n      <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://t.me/alfa_appointments_bot" alt="QR код бота">\n    </div>\n    <div class="veh-bot-content">\n      <div class="veh-bot-title">\n        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>\n        Telegram-бот напоминаний\n      </div>\n      <div class="veh-bot-desc">\n        Подпишитесь на бота, чтобы получать уведомления об истечении сроков страховки и о необходимости прохождения ТО.\n      </div>\n      <a href="https://t.me/alfa_appointments_bot" target="_blank" class="veh-bot-link">\n        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>\n        Открыть бота\n      </a>\n    </div>\n  </div>\n\n  <!-- Статистика -->\n  <div class="veh-stats">\n    <div class="veh-stat-card">\n      <div class="veh-stat-icon total"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg></div>\n      <div class="veh-stat-info"><span class="veh-stat-value" id="stat-total">0</span><span class="veh-stat-label">Всего ТС</span></div>\n    </div>\n    <div class="veh-stat-card">\n      <div class="veh-stat-icon danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>\n      <div class="veh-stat-info"><span class="veh-stat-value" id="stat-expired">0</span><span class="veh-stat-label">Просрочено</span></div>\n    </div>\n    <div class="veh-stat-card">\n      <div class="veh-stat-icon warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>\n      <div class="veh-stat-info"><span class="veh-stat-value" id="stat-soon">0</span><span class="veh-stat-label">Истекает ≤30 дней</span></div>\n    </div>\n    <div class="veh-stat-card">\n      <div class="veh-stat-icon info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>\n      <div class="veh-stat-info"><span class="veh-stat-value" id="stat-to">0</span><span class="veh-stat-label">Скоро ТО (≤5000 км)</span></div>\n    </div>\n  </div>\n\n  <!-- Тулбар -->\n  <div class="veh-toolbar">\n    <div class="veh-filters">\n      <div class="veh-filter-group">\n        <input type="text" id="filter-search" placeholder="🔍 Поиск по марке, номеру..." class="veh-input" oninput="vehApp.debounceLoad()">\n      </div>\n      <div class="veh-filter-group">\n        <select id="filter-condition" class="veh-select" onchange="vehApp.resetAndLoad()">\n          <option value="">Все состояния</option>\n          <option value="Хорошее">Хорошее</option>\n          <option value="Удовлетворительное">Удовлетворительное</option>\n          <option value="Плохое">Плохое</option>\n        </select>\n      </div>\n    </div>\n    <button class="veh-btn veh-btn-primary" onclick="vehApp.openAddModal()">\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\n      Добавить\n    </button>\n  </div>\n\n  <!-- Таблица -->\n  <div class="veh-table-container">\n    <table class="veh-table">\n      <thead>\n        <tr>\n          <th class="sortable" onclick="vehApp.sortTable('carBrand')">Марка авто <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="vehApp.sortTable('organization')">Организация <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="vehApp.sortTable('licensePlate')">Гос. номер <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="vehApp.sortTable('carYear')">Год <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="vehApp.sortTable('mileage')">Пробег / ТО <span class="sort-icon">↕</span></th>\n          <th class="sortable sorted" onclick="vehApp.sortTable('insuranceDate')">Страховка <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="vehApp.sortTable('condition')">Состояние <span class="sort-icon">↕</span></th>\n          <th>Действия</th>\n        </tr>\n      </thead>\n      <tbody id="veh-table-body">\n        <tr><td colspan="8" class="veh-loading">Загрузка...</td></tr>\n      </tbody>\n    </table>\n    <div class="veh-pagination" id="veh-pagination" style="display:none;">\n      <div class="veh-pagination-info">\n        Показано <span id="pag-start">0</span>–<span id="pag-end">0</span> из <span id="pag-total">0</span>\n      </div>\n      <div class="veh-pagination-controls" id="pag-controls"></div>\n    </div>\n  </div>\n\n  <!-- Модальное окно -->\n  <div class="veh-modal" id="veh-modal" style="display:none;">\n    <div class="veh-modal-content">\n      <div class="veh-modal-header">\n        <h3 id="modal-title">Добавить ТС</h3>\n        <button class="veh-modal-close" onclick="vehApp.closeModal()">×</button>\n      </div>\n      <form id="veh-form" onsubmit="return vehApp.saveVehicle(event)">\n        <input type="hidden" id="edit-id">\n        <div class="veh-form-row">\n          <div class="veh-form-group">\n            <label>Марка авто *</label>\n            <input type="text" id="edit-carbrand" class="veh-input" required placeholder="Toyota Camry">\n          </div>\n          <div class="veh-form-group">\n            <label>Организация *</label>\n            <input type="text" id="edit-organization" class="veh-input" required placeholder="ООО Компания">\n          </div>\n        </div>\n        <div class="veh-form-row">\n          <div class="veh-form-group">\n            <label>Гос. номер *</label>\n            <input type="text" id="edit-licenseplate" class="veh-input" required placeholder="А123БВ777">\n          </div>\n          <div class="veh-form-group">\n            <label>Год авто *</label>\n            <input type="number" id="edit-caryear" class="veh-input" required min="1990" max="2030" placeholder="2020">\n          </div>\n        </div>\n        <div class="veh-form-row">\n          <div class="veh-form-group">\n            <label>Пробег (км) *</label>\n            <input type="number" id="edit-mileage" class="veh-input" required min="0" placeholder="150000">\n          </div>\n          <div class="veh-form-group">\n            <label>ТО на (км) *</label>\n            <input type="number" id="edit-nextto" class="veh-input" required min="0" placeholder="160000">\n          </div>\n        </div>\n        <div class="veh-form-row">\n          <div class="veh-form-group">\n            <label>Страховка до *</label>\n            <input type="date" id="edit-insurancedate" class="veh-input" required>\n          </div>\n          <div class="veh-form-group">\n            <label>Состояние *</label>\n            <select id="edit-condition" class="veh-select" required>\n              <option value="">Выберите...</option>\n              <option value="Хорошее">Хорошее</option>\n              <option value="Удовлетворительное">Удовлетворительное</option>\n              <option value="Плохое">Плохое</option>\n            </select>\n          </div>\n        </div>\n        <div class="veh-form-group full-width">\n          <label>Комментарий</label>\n          <textarea id="edit-comment" class="veh-textarea" rows="2" placeholder="Дополнительная информация..."></textarea>\n        </div>\n        <div class="veh-modal-footer">\n          <button type="button" class="veh-btn veh-btn-secondary" onclick="vehApp.closeModal()">Отмена</button>\n          <button type="submit" class="veh-btn veh-btn-primary">Сохранить</button>\n        </div>\n      </form>\n    </div>\n  </div>\n\n  <div id="veh-toast" class="veh-toast"></div>\n</div>\n\n<script>\nwindow.vehApp = (function() {\n  var API_URL = window.location.protocol + '//' + window.location.hostname + ':9001/api/vehicles';\n  var vehicles = [];\n  var sortField = 'insuranceDate';\n  var sortOrder = 'ASC';\n  var debounceTimer = null;\n  var currentPage = 1;\n  var pageSize = 20;\n  var highlightId = null;\n\n  function getToken() {\n    return localStorage.getItem('token');\n  }\n\n  function fetchAPI(url, options) {\n    options = options || {};\n    return fetch(url, {\n      method: options.method || 'GET',\n      headers: {\n        'Content-Type': 'application/json',\n        'Authorization': 'Bearer ' + getToken()\n      },\n      body: options.body\n    }).then(function(r) {\n      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Error'); });\n      return r.json();\n    });\n  }\n\n  function showToast(msg, type) {\n    var t = document.getElementById('veh-toast');\n    t.textContent = msg;\n    t.className = 'veh-toast show ' + (type || '');\n    setTimeout(function() { t.className = 'veh-toast'; }, 3000);\n  }\n\n  function escapeHtml(s) {\n    if (!s) return '';\n    var d = document.createElement('div');\n    d.textContent = s;\n    return d.innerHTML;\n  }\n\n  function formatDate(ds) {\n    var d = new Date(ds);\n    return ('0'+d.getDate()).slice(-2) + '.' + ('0'+(d.getMonth()+1)).slice(-2) + '.' + d.getFullYear();\n  }\n\n  function formatNumber(n) {\n    return n ? n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ') : '0';\n  }\n\n  function getDateClass(ds) {\n    var diff = Math.ceil((new Date(ds) - new Date().setHours(0,0,0,0)) / 86400000);\n    if (diff < 0) return 'expired';\n    if (diff <= 7) return 'critical';\n    if (diff <= 30) return 'warning';\n    if (diff <= 90) return 'soon';\n    return 'ok';\n  }\n\n  function getMileageClass(mileage, nextTO) {\n    var diff = nextTO - mileage;\n    if (diff <= 0) return 'expired';\n    if (diff <= 1000) return 'critical';\n    if (diff <= 3000) return 'warning';\n    if (diff <= 5000) return 'soon';\n    return 'ok';\n  }\n\n  function getConditionClass(cond) {\n    if (cond === 'Хорошее') return 'good';\n    if (cond === 'Удовлетворительное') return 'satisfactory';\n    return 'poor';\n  }\n\n  function loadData() {\n    var search = document.getElementById('filter-search').value;\n    var cond = document.getElementById('filter-condition').value;\n    \n    var url = API_URL + '?sortBy=' + sortField + '&sortOrder=' + sortOrder;\n    if (search) url += '&search=' + encodeURIComponent(search);\n    if (cond) url += '&condition=' + encodeURIComponent(cond);\n\n    fetchAPI(url).then(function(data) {\n      vehicles = data;\n      if (currentPage > Math.ceil(vehicles.length / pageSize)) {\n        currentPage = 1;\n      }\n      renderTable();\n      renderPagination();\n      loadStats();\n    }).catch(function(e) { \n      document.getElementById('veh-table-body').innerHTML = '<tr><td colspan="8" class="veh-empty">Ошибка загрузки данных</td></tr>';\n      showToast('Ошибка: ' + e.message, 'error'); \n    });\n  }\n\n  function loadStats() {\n    fetchAPI(API_URL + '/stats').then(function(s) {\n      document.getElementById('stat-total').textContent = s.total;\n      document.getElementById('stat-expired').textContent = s.expired;\n      document.getElementById('stat-soon').textContent = s.expiringSoon;\n      document.getElementById('stat-to').textContent = s.needsTO;\n    });\n  }\n\n  function renderTable() {\n    var tb = document.getElementById('veh-table-body');\n    if (!vehicles.length) {\n      tb.innerHTML = '<tr><td colspan="8" class="veh-empty">Нет данных</td></tr>';\n      return;\n    }\n    var start = (currentPage - 1) * pageSize;\n    var end = Math.min(start + pageSize, vehicles.length);\n    var pageData = vehicles.slice(start, end);\n    \n    tb.innerHTML = pageData.map(function(v) {\n      var isHighlighted = highlightId && v.id === highlightId;\n      var dateClass = getDateClass(v.insuranceDate);\n      var mileageClass = getMileageClass(v.mileage, v.nextTO);\n      var condClass = getConditionClass(v.condition);\n      \n      return '<tr data-id="' + v.id + '"' + (isHighlighted ? ' class="veh-highlight"' : '') + '>' +\n        '<td><strong>' + escapeHtml(v.carBrand) + '</strong></td>' +\n        '<td><span class="veh-organization">' + escapeHtml(v.organization) + '</span></td>' +\n        '<td>' + escapeHtml(v.licensePlate) + '</td>' +\n        '<td>' + v.carYear + '</td>' +\n        '<td><span class="veh-mileage ' + mileageClass + '">' + formatNumber(v.mileage) + ' / ' + formatNumber(v.nextTO) + '</span></td>' +\n        '<td><span class="veh-date ' + dateClass + '">' + formatDate(v.insuranceDate) + '</span></td>' +\n        '<td><span class="veh-condition ' + condClass + '">' + escapeHtml(v.condition) + '</span></td>' +\n        '<td class="veh-actions">' +\n          '<button class="veh-btn-icon edit" onclick="vehApp.editVehicle(\\'' + v.id + '\\')" title="Редактировать">' +\n            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +\n          '</button>' +\n          '<button class="veh-btn-icon delete" onclick="vehApp.deleteVehicle(\\'' + v.id + '\\')" title="Удалить">' +\n            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +\n          '</button>' +\n        '</td>' +\n      '</tr>';\n    }).join('');\n\n    if (highlightId) {\n      setTimeout(function() { highlightId = null; }, 3000);\n    }\n  }\n\n  function renderPagination() {\n    var total = vehicles.length;\n    var totalPages = Math.ceil(total / pageSize);\n    var pagEl = document.getElementById('veh-pagination');\n    \n    if (totalPages <= 1) {\n      pagEl.style.display = 'none';\n      return;\n    }\n    \n    pagEl.style.display = 'flex';\n    \n    var start = (currentPage - 1) * pageSize + 1;\n    var end = Math.min(currentPage * pageSize, total);\n    \n    document.getElementById('pag-start').textContent = start;\n    document.getElementById('pag-end').textContent = end;\n    document.getElementById('pag-total').textContent = total;\n    \n    var html = '<button class="veh-pagination-btn" onclick="vehApp.goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>' +\n      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';\n    \n    var startPage = Math.max(1, currentPage - 2);\n    var endPage = Math.min(totalPages, startPage + 4);\n    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);\n    \n    if (startPage > 1) {\n      html += '<button class="veh-pagination-btn" onclick="vehApp.goToPage(1)">1</button>';\n      if (startPage > 2) html += '<span style="color:#9ca3af;padding:0 4px;">...</span>';\n    }\n    \n    for (var i = startPage; i <= endPage; i++) {\n      html += '<button class="veh-pagination-btn' + (i === currentPage ? ' active' : '') + '" onclick="vehApp.goToPage(' + i + ')">' + i + '</button>';\n    }\n    \n    if (endPage < totalPages) {\n      if (endPage < totalPages - 1) html += '<span style="color:#9ca3af;padding:0 4px;">...</span>';\n      html += '<button class="veh-pagination-btn" onclick="vehApp.goToPage(' + totalPages + ')">' + totalPages + '</button>';\n    }\n    \n    html += '<button class="veh-pagination-btn" onclick="vehApp.goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>' +\n      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>';\n    \n    document.getElementById('pag-controls').innerHTML = html;\n  }\n\n  function goToPage(p) {\n    var totalPages = Math.ceil(vehicles.length / pageSize) || 1;\n    if (p < 1 || p > totalPages) return;\n    currentPage = p;\n    renderTable();\n    renderPagination();\n  }\n\n  function sortTable(field) {\n    var ths = document.querySelectorAll('.veh-table th');\n    ths.forEach(function(th) { th.classList.remove('sorted'); });\n    \n    if (sortField === field) {\n      sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';\n    } else {\n      sortField = field;\n      sortOrder = 'ASC';\n    }\n    \n    event.target.closest('th').classList.add('sorted');\n    loadData();\n  }\n\n  function debounceLoad() {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(loadData, 300);\n  }\n\n  function resetAndLoad() {\n    currentPage = 1;\n    loadData();\n  }\n\n  function openAddModal() {\n    document.getElementById('modal-title').textContent = 'Добавить ТС';\n    document.getElementById('veh-form').reset();\n    document.getElementById('edit-id').value = '';\n    document.getElementById('veh-modal').style.display = 'flex';\n  }\n\n  function closeModal() {\n    document.getElementById('veh-modal').style.display = 'none';\n  }\n\n  function editVehicle(id) {\n    var v = vehicles.find(function(x) { return x.id === id; });\n    if (!v) return;\n    \n    document.getElementById('modal-title').textContent = 'Редактировать ТС';\n    document.getElementById('edit-id').value = v.id;\n    document.getElementById('edit-carbrand').value = v.carBrand;\n    document.getElementById('edit-organization').value = v.organization;\n    document.getElementById('edit-licenseplate').value = v.licensePlate;\n    document.getElementById('edit-caryear').value = v.carYear;\n    document.getElementById('edit-mileage').value = v.mileage;\n    document.getElementById('edit-nextto').value = v.nextTO;\n    document.getElementById('edit-insurancedate').value = v.insuranceDate;\n    document.getElementById('edit-condition').value = v.condition;\n    document.getElementById('edit-comment').value = v.comment || '';\n    document.getElementById('veh-modal').style.display = 'flex';\n  }\n\n  function saveVehicle(e) {\n    e.preventDefault();\n    var id = document.getElementById('edit-id').value;\n    var data = {\n      carBrand: document.getElementById('edit-carbrand').value,\n      organization: document.getElementById('edit-organization').value,\n      licensePlate: document.getElementById('edit-licenseplate').value,\n      carYear: parseInt(document.getElementById('edit-caryear').value),\n      mileage: parseInt(document.getElementById('edit-mileage').value),\n      nextTO: parseInt(document.getElementById('edit-nextto').value),\n      insuranceDate: document.getElementById('edit-insurancedate').value,\n      condition: document.getElementById('edit-condition').value,\n      comment: document.getElementById('edit-comment').value\n    };\n\n    var url = id ? API_URL + '/' + id : API_URL;\n    var method = id ? 'PUT' : 'POST';\n\n    fetchAPI(url, { method: method, body: JSON.stringify(data) })\n      .then(function(result) {\n        showToast(id ? 'ТС обновлено' : 'ТС добавлено', 'success');\n        closeModal();\n        highlightId = result.id;\n        loadData();\n      })\n      .catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n    \n    return false;\n  }\n\n  function deleteVehicle(id) {\n    if (!confirm('Удалить это ТС?')) return;\n    \n    fetchAPI(API_URL + '/' + id, { method: 'DELETE' })\n      .then(function() {\n        showToast('ТС удалено', 'success');\n        loadData();\n      })\n      .catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  // Проверяем highlight из URL\n  function checkHighlight() {\n    var params = new URLSearchParams(window.location.search);\n    var hl = params.get('highlight');\n    if (hl) {\n      highlightId = hl;\n      history.replaceState(null, '', window.location.pathname);\n    }\n  }\n\n  // Init\n  checkHighlight();\n  loadData();\n\n  return {\n    loadData: loadData,\n    debounceLoad: debounceLoad,\n    sortTable: sortTable,\n    goToPage: goToPage,\n    resetAndLoad: resetAndLoad,\n    openAddModal: openAddModal,\n    closeModal: closeModal,\n    editVehicle: editVehicle,\n    saveVehicle: saveVehicle,\n    deleteVehicle: deleteVehicle\n  };\n})();\n</script>	html		{}	Telegram-бот напоминаний Подпишитесь на бота, чтобы получать уведомления об истечении сроков страховки и о необходимости прохождения ТО. Открыть бота 0Всего ТС 0Просрочено 0Истекает ≤30 дней 0Скоро ТО (≤5000 км) Добавить Марка авто ↕ Организация ↕ Гос. номер ↕ Год ↕ Пробег / ТО ↕ Страховка ↕ Состояние ↕ Действия Загрузка... Показано 0–0 из 0 Добавить ТС × Марка авто * Организация * Гос. номер * Год авто * Пробег (км) * ТО на (км) * Страховка до * Состояние * Комментарий Отмена Сохранить	file-text	e2928484-6bbc-4f29-8016-ecf0df98d02f	2	f	f	{}			{}	2026-01-01 23:17:50.088+03	2026-01-02 03:19:25.846+03	73e7e5ea-13eb-4509-bed7-441541ed1447	73e7e5ea-13eb-4509-bed7-441541ed1447
af343927-d7d7-4d4a-b492-920e7349aa8c	akr	Аккредитации тест	<style>\n#accreditations-app {\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n  max-width: 100%;\n  margin: 0 auto;\n}\n\n/* Блок Telegram бота */\n.acc-bot-info {\n  display: flex;\n  align-items: center;\n  gap: 20px;\n  padding: 20px 24px;\n  background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%);\n  border: 1px solid #7dd3fc;\n  border-radius: 12px;\n  margin-bottom: 24px;\n}\n\n.acc-bot-qr {\n  width: 100px;\n  height: 100px;\n  background: #fff;\n  border-radius: 8px;\n  padding: 8px;\n  flex-shrink: 0;\n}\n\n.acc-bot-qr img {\n  width: 100%;\n  height: 100%;\n  display: block;\n  margin: 0;\n}\n\n.acc-bot-content {\n  flex: 1;\n}\n\n.acc-bot-title {\n  font-size: 16px;\n  font-weight: 600;\n  color: #0c4a6e;\n  margin-bottom: 6px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.acc-bot-title svg {\n  width: 20px;\n  height: 20px;\n  color: #0ea5e9;\n}\n\n.acc-bot-desc {\n  font-size: 14px;\n  color: #075985;\n  margin-bottom: 10px;\n  line-height: 1.4;\n}\n\n.acc-bot-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 16px;\n  background: #0ea5e9;\n  color: #fff !important;\n  text-decoration: none;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  transition: background 0.2s;\n}\n\n.acc-bot-link:hover,\n.acc-bot-link:visited {\n  background: #0284c7;\n  color: #fff !important;\n}\n\n.acc-stats {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\n  gap: 16px;\n  margin-bottom: 24px;\n}\n\n.acc-stat-card {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  padding: 20px;\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n  border: 1px solid #e5e7eb;\n}\n\n.acc-stat-icon {\n  width: 48px;\n  height: 48px;\n  border-radius: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n}\n\n.acc-stat-icon svg { width: 24px; height: 24px; }\n.acc-stat-icon.total { background: #e0f2fe; color: #0284c7; }\n.acc-stat-icon.danger { background: #fee2e2; color: #dc2626; }\n.acc-stat-icon.warning { background: #fef3c7; color: #d97706; }\n.acc-stat-icon.info { background: #dbeafe; color: #2563eb; }\n\n.acc-stat-info { display: flex; flex-direction: column; }\n.acc-stat-value { font-size: 28px; font-weight: 700; color: #1f2937; line-height: 1; }\n.acc-stat-label { font-size: 13px; color: #6b7280; margin-top: 4px; }\n\n.acc-toolbar {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 16px;\n  margin-bottom: 20px;\n  flex-wrap: wrap;\n}\n\n.acc-filters {\n  display: flex;\n  gap: 12px;\n  flex-wrap: wrap;\n  flex: 1;\n}\n\n.acc-filter-group { min-width: 180px; }\n\n.acc-input, .acc-select, .acc-textarea {\n  width: 100%;\n  padding: 10px 14px;\n  border: 1px solid #d1d5db;\n  border-radius: 8px;\n  font-size: 14px;\n  transition: border-color 0.2s, box-shadow 0.2s;\n  background: #fff;\n  color: #1f2937;\n  box-sizing: border-box;\n}\n\n.acc-input:focus, .acc-select:focus, .acc-textarea:focus {\n  outline: none;\n  border-color: #3b82f6;\n  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);\n}\n\n.acc-textarea { resize: vertical; min-height: 80px; }\n\n.acc-btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 18px;\n  border: none;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  cursor: pointer;\n  transition: all 0.2s;\n  white-space: nowrap;\n}\n\n.acc-btn svg { width: 18px; height: 18px; }\n\n.acc-btn-primary {\n  background: linear-gradient(135deg, #3b82f6, #2563eb);\n  color: #fff;\n}\n.acc-btn-primary:hover { background: linear-gradient(135deg, #2563eb, #1d4ed8); transform: translateY(-1px); }\n\n.acc-btn-secondary { background: #f3f4f6; color: #374151; }\n.acc-btn-secondary:hover { background: #e5e7eb; }\n\n.acc-btn-icon {\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  justify-content: center;\n  border-radius: 6px;\n}\n\n.acc-btn-edit { background: #dbeafe; color: #2563eb; }\n.acc-btn-edit:hover { background: #bfdbfe; }\n.acc-btn-delete { background: #fee2e2; color: #dc2626; }\n.acc-btn-delete:hover { background: #fecaca; }\n\n.acc-table-container {\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n  border: 1px solid #e5e7eb;\n  overflow-x: auto;\n  margin-top: 0;\n}\n\n.acc-table {\n  width: 100%;\n  border-collapse: collapse;\n  margin: 0 !important;\n}\n\n.acc-table th {\n  background: #f8fafc;\n  padding: 14px 16px;\n  text-align: center;\n  font-weight: 600;\n  font-size: 13px;\n  color: #4b5563;\n  border-bottom: 2px solid #e5e7eb;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  vertical-align: middle;\n}\n\n.acc-table th.sortable { cursor: pointer; user-select: none; }\n.acc-table th.sortable:hover { background: #f1f5f9; }\n.sort-icon { opacity: 0.4; margin-left: 4px; }\n.acc-table th.sorted .sort-icon { opacity: 1; color: #3b82f6; }\n\n.acc-table td {\n  padding: 14px 16px;\n  border-bottom: 1px solid #f1f5f9;\n  font-size: 14px;\n  color: #374151;\n  vertical-align: middle;\n}\n\n.acc-table tr:hover { background: #f8fafc; }\n.acc-table tr:last-child td { border-bottom: none; }\n\n/* Индикация дат - исправленные цвета */\n.acc-date { padding: 4px 10px; border-radius: 20px; font-size: 13px; font-weight: 500; display: inline-block; }\n.acc-date.expired { background: #fee2e2; color: #dc2626; }\n.acc-date.critical { background: #fef2f2; color: #b91c1c; }\n.acc-date.warning { background: #fef3c7; color: #b45309; }\n.acc-date.soon { background: #fef9c3; color: #a16207; }\n.acc-date.ok { background: #dcfce7; color: #16a34a; }\n\n.acc-actions { display: flex; gap: 6px; }\n\n.acc-loading, .acc-empty { text-align: center; padding: 40px !important; color: #9ca3af; }\n\n.acc-modal {\n  position: fixed;\n  inset: 0;\n  background: rgba(0,0,0,0.5);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 10000;\n  backdrop-filter: blur(4px);\n}\n\n.acc-modal-content {\n  background: #fff;\n  border-radius: 16px;\n  width: 100%;\n  max-width: 500px;\n  max-height: 90vh;\n  overflow-y: auto;\n  box-shadow: 0 20px 60px rgba(0,0,0,0.3);\n  margin: 16px;\n}\n\n.acc-modal-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 20px 24px;\n  border-bottom: 1px solid #e5e7eb;\n}\n\n.acc-modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; color: #1f2937; }\n\n.acc-modal-close {\n  width: 32px;\n  height: 32px;\n  border: none;\n  background: #f3f4f6;\n  border-radius: 8px;\n  font-size: 20px;\n  cursor: pointer;\n  color: #6b7280;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.acc-modal-close:hover { background: #e5e7eb; }\n\n#acc-form { padding: 24px; }\n\n.acc-form-group { margin-bottom: 18px; }\n.acc-form-group label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151; }\n\n.acc-modal-footer {\n  display: flex;\n  justify-content: flex-end;\n  gap: 12px;\n  padding-top: 16px;\n  border-top: 1px solid #e5e7eb;\n  margin-top: 8px;\n}\n\n.acc-toast {\n  position: fixed;\n  bottom: 24px;\n  right: 24px;\n  padding: 14px 20px;\n  background: #1f2937;\n  color: #fff;\n  border-radius: 10px;\n  font-size: 14px;\n  opacity: 0;\n  transform: translateY(20px);\n  transition: all 0.3s;\n  z-index: 10001;\n  box-shadow: 0 10px 30px rgba(0,0,0,0.2);\n}\n.acc-toast.show { opacity: 1; transform: translateY(0); }\n.acc-toast.success { background: #059669; }\n.acc-toast.error { background: #dc2626; }\n\n/* Пагинация */\n.acc-pagination {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 16px 20px;\n  background: #f8fafc;\n  border-top: 1px solid #e5e7eb;\n  gap: 16px;\n}\n\n.acc-pagination-info {\n  font-size: 14px;\n  color: #6b7280;\n}\n\n.acc-pagination-controls {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.acc-pagination-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 36px;\n  height: 36px;\n  padding: 0 12px;\n  border: 1px solid #d1d5db;\n  background: #fff;\n  border-radius: 8px;\n  font-size: 14px;\n  color: #374151;\n  cursor: pointer;\n  transition: all 0.2s;\n}\n\n.acc-pagination-btn:hover:not(:disabled) {\n  background: #f3f4f6;\n  border-color: #9ca3af;\n}\n\n.acc-pagination-btn:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n.acc-pagination-btn.active {\n  background: #3b82f6;\n  border-color: #3b82f6;\n  color: #fff;\n}\n\n.acc-pagination-btn svg {\n  width: 16px;\n  height: 16px;\n}\n\n/* Цвета медцентров - обновлённые */\n.acc-medcenter {\n  padding: 4px 10px;\n  border-radius: 6px;\n  font-size: 13px;\n  font-weight: 500;\n  display: inline-block;\n}\n.acc-medcenter[data-center="Альфа"] { background: #fce7f3; color: #be185d; }\n.acc-medcenter[data-center="Кидс"] { background: #ffedd5; color: #c2410c; }\n.acc-medcenter[data-center="Проф"] { background: #ede9fe; color: #6d28d9; }\n.acc-medcenter[data-center="3К"] { background: #fdf4ff; color: #a21caf; }\n.acc-medcenter[data-center="Смайл"] { background: #f3f4f6; color: #4b5563; }\n.acc-medcenter[data-center="Линия"] { background: #fef3c7; color: #92400e; }\n\n/* Подсветка найденной записи из поиска */\n.acc-highlight {\n  animation: highlightPulse 3s ease-out;\n}\n.acc-highlight td {\n  background: #fef3c7 !important;\n}\n@keyframes highlightPulse {\n  0%, 50% { background: #fde68a; }\n  100% { background: transparent; }\n}\n\n/* Планшеты */\n@media (max-width: 1024px) {\n  .acc-table th, .acc-table td { padding: 12px 10px; }\n  .acc-stats { grid-template-columns: repeat(2, 1fr); }\n}\n\n/* Мобильные устройства */\n@media (max-width: 768px) {\n  .acc-bot-info { \n    flex-direction: column; \n    text-align: center; \n    padding: 16px;\n    gap: 16px;\n  }\n  .acc-bot-qr { width: 120px; height: 120px; }\n  .acc-bot-desc { font-size: 13px; }\n  \n  .acc-stats { grid-template-columns: 1fr 1fr; gap: 10px; }\n  .acc-stat-card { padding: 14px 12px; gap: 12px; }\n  .acc-stat-icon { width: 40px; height: 40px; }\n  .acc-stat-icon svg { width: 20px; height: 20px; }\n  .acc-stat-value { font-size: 22px; }\n  .acc-stat-label { font-size: 11px; }\n  \n  .acc-toolbar { flex-direction: column; align-items: stretch; gap: 12px; }\n  .acc-filters { flex-direction: column; gap: 10px; }\n  .acc-filter-group { min-width: 100%; }\n  .acc-btn-primary { width: 100%; justify-content: center; }\n  \n  .acc-table-container { border-radius: 8px; }\n  .acc-table { font-size: 13px; }\n  .acc-table th { \n    padding: 10px 8px; \n    font-size: 11px;\n    letter-spacing: 0;\n  }\n  .acc-table td { padding: 10px 8px; }\n  \n  .acc-table th:nth-child(5),\n  .acc-table td:nth-child(5) { display: none; }\n  \n  .acc-medcenter, .acc-date { \n    padding: 3px 8px; \n    font-size: 11px; \n  }\n  \n  .acc-btn-icon { width: 28px; height: 28px; }\n  .acc-btn-icon svg { width: 14px; height: 14px; }\n  \n  .acc-modal-content { \n    margin: 8px; \n    max-height: calc(100vh - 16px);\n    border-radius: 12px;\n  }\n  .acc-modal-header { padding: 16px; }\n  .acc-modal-header h3 { font-size: 16px; }\n  #acc-form { padding: 16px; }\n  .acc-form-group { margin-bottom: 14px; }\n  .acc-input, .acc-select, .acc-textarea { padding: 12px; font-size: 16px; }\n  \n  .acc-toast { \n    left: 16px; \n    right: 16px; \n    bottom: 16px; \n    text-align: center;\n  }\n  \n  .acc-pagination { flex-wrap: wrap; justify-content: center; }\n}\n\n/* Маленькие мобильные */\n@media (max-width: 480px) {\n  .acc-stats { grid-template-columns: 1fr; gap: 8px; }\n  .acc-stat-card { \n    flex-direction: row; \n    justify-content: flex-start;\n    padding: 12px 16px;\n  }\n  \n  .acc-table th:nth-child(3),\n  .acc-table td:nth-child(3) { display: none; }\n  \n  .acc-table th:first-child,\n  .acc-table td:first-child { \n    max-width: 70px;\n  }\n  \n  .acc-medcenter {\n    max-width: 60px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n  \n  .acc-bot-qr { width: 100px; height: 100px; }\n  .acc-bot-link { \n    width: 100%; \n    justify-content: center;\n    padding: 10px 16px;\n  }\n  \n  .acc-pagination { \n    flex-direction: column; \n    gap: 12px;\n    padding: 12px 16px;\n  }\n  .acc-pagination-info { text-align: center; }\n  .acc-pagination-btn { min-width: 32px; height: 32px; padding: 0 8px; font-size: 13px; }\n}\n</style>\n\n<div id="accreditations-app">\n  <!-- Блок с информацией о Telegram боте -->\n  <div class="acc-bot-info">\n    <div class="acc-bot-qr">\n      <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://t.me/alfa_appointments_bot" alt="QR код бота">\n    </div>\n    <div class="acc-bot-content">\n      <div class="acc-bot-title">\n        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>\n        Telegram-бот напоминаний\n      </div>\n      <div class="acc-bot-desc">\n        Подпишитесь на бота, чтобы получать уведомления об истечении сроков аккредитаций за 90, 60, 30, 14 и 7 дней.\n      </div>\n      <a href="https://t.me/alfa_appointments_bot" target="_blank" class="acc-bot-link">\n        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>\n        @alfa_appointments_bot\n      </a>\n    </div>\n  </div>\n\n  <div class="acc-stats">\n    <div class="acc-stat-card">\n      <div class="acc-stat-icon total"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-total">0</span><span class="acc-stat-label">Всего</span></div>\n    </div>\n    <div class="acc-stat-card danger">\n      <div class="acc-stat-icon danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-expired">0</span><span class="acc-stat-label">Просрочено</span></div>\n    </div>\n    <div class="acc-stat-card warning">\n      <div class="acc-stat-icon warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-soon">0</span><span class="acc-stat-label">Истекает ≤30 дней</span></div>\n    </div>\n    <div class="acc-stat-card info">\n      <div class="acc-stat-icon info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>\n      <div class="acc-stat-info"><span class="acc-stat-value" id="stat-90">0</span><span class="acc-stat-label">Истекает ≤90 дней</span></div>\n    </div>\n  </div>\n\n  <div class="acc-toolbar">\n    <div class="acc-filters">\n      <div class="acc-filter-group">\n        <input type="text" id="filter-search" placeholder="🔍 Поиск по ФИО..." class="acc-input" oninput="accApp.debounceLoad()">\n      </div>\n      <div class="acc-filter-group">\n        <select id="filter-medcenter" class="acc-select" onchange="accApp.resetAndLoad()">\n          <option value="">Все медцентры</option>\n          <option value="Альфа">Альфа</option>\n          <option value="Кидс">Кидс</option>\n          <option value="Проф">Проф</option>\n          <option value="Линия">Линия</option>\n          <option value="Смайл">Смайл</option>\n          <option value="3К">3К</option>\n        </select>\n      </div>\n      <div class="acc-filter-group">\n        <select id="filter-specialty" class="acc-select" onchange="accApp.resetAndLoad()">\n          <option value="">Все специальности</option>\n        </select>\n      </div>\n    </div>\n    <button class="acc-btn acc-btn-primary" onclick="accApp.openAddModal()">\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\n      Добавить\n    </button>\n  </div>\n\n  <div class="acc-table-container">\n    <table class="acc-table">\n      <thead>\n        <tr>\n          <th class="sortable" onclick="accApp.sortTable('medCenter')">Медцентр <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="accApp.sortTable('fullName')">ФИО <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="accApp.sortTable('specialty')">Специальность <span class="sort-icon">↕</span></th>\n          <th class="sortable" onclick="accApp.sortTable('expirationDate')">Срок действия <span class="sort-icon">↕</span></th>\n          <th>Комментарий</th>\n          <th style="text-align:center">Действия</th>\n        </tr>\n      </thead>\n      <tbody id="acc-table-body">\n        <tr><td colspan="6" class="acc-loading">Загрузка...</td></tr>\n      </tbody>\n    </table>\n    <div class="acc-pagination" id="acc-pagination" style="display:none">\n      <div class="acc-pagination-info" id="pagination-info">Показано 1-20 из 100</div>\n      <div class="acc-pagination-controls" id="pagination-controls"></div>\n    </div>\n  </div>\n\n  <div id="acc-modal" class="acc-modal" style="display:none" onclick="if(event.target===this)accApp.closeModal()">\n    <div class="acc-modal-content">\n      <div class="acc-modal-header">\n        <h3 id="modal-title">Добавить запись</h3>\n        <button class="acc-modal-close" onclick="accApp.closeModal()">&times;</button>\n      </div>\n      <form id="acc-form" onsubmit="accApp.saveRecord(event)">\n        <input type="hidden" id="edit-id">\n        <div class="acc-form-group">\n          <label>Медцентр *</label>\n          <select id="edit-medcenter" required class="acc-select">\n            <option value="">Выберите...</option>\n            <option value="Альфа">Альфа</option>\n            <option value="Кидс">Кидс</option>\n            <option value="Проф">Проф</option>\n            <option value="Линия">Линия</option>\n            <option value="Смайл">Смайл</option>\n            <option value="3К">3К</option>\n          </select>\n        </div>\n        <div class="acc-form-group">\n          <label>ФИО *</label>\n          <input type="text" id="edit-fullname" required class="acc-input" placeholder="Иванов Иван Иванович">\n        </div>\n        <div class="acc-form-group">\n          <label>Специальность *</label>\n          <input type="text" id="edit-specialty" required class="acc-input" placeholder="Терапия" list="specialties-list">\n          <datalist id="specialties-list"></datalist>\n        </div>\n        <div class="acc-form-group">\n          <label>Срок действия *</label>\n          <input type="date" id="edit-expdate" required class="acc-input">\n        </div>\n        <div class="acc-form-group">\n          <label>Комментарий</label>\n          <textarea id="edit-comment" class="acc-textarea" rows="3" placeholder="Дополнительная информация..."></textarea>\n        </div>\n        <div class="acc-modal-footer">\n          <button type="button" class="acc-btn acc-btn-secondary" onclick="accApp.closeModal()">Отмена</button>\n          <button type="submit" class="acc-btn acc-btn-primary">Сохранить</button>\n        </div>\n      </form>\n    </div>\n  </div>\n\n  <div id="acc-toast" class="acc-toast"></div>\n</div>\n\n<script>\nwindow.accApp = (function() {\n  var API_URL = window.location.protocol + '//' + window.location.hostname + ':9001/api/accreditations';\n  var accreditations = [];\n  var sortField = 'expirationDate';\n  var sortOrder = 'ASC';\n  var debounceTimer = null;\n  var currentPage = 1;\n  var pageSize = 20;\n  var highlightId = null;\n\n  function getToken() {\n    return localStorage.getItem('token');\n  }\n\n  function fetchAPI(url, options) {\n    options = options || {};\n    return fetch(url, {\n      method: options.method || 'GET',\n      headers: {\n        'Content-Type': 'application/json',\n        'Authorization': 'Bearer ' + getToken()\n      },\n      body: options.body\n    }).then(function(r) {\n      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Error'); });\n      return r.json();\n    });\n  }\n\n  function showToast(msg, type) {\n    var t = document.getElementById('acc-toast');\n    t.textContent = msg;\n    t.className = 'acc-toast show ' + (type || '');\n    setTimeout(function() { t.className = 'acc-toast'; }, 3000);\n  }\n\n  function escapeHtml(s) {\n    if (!s) return '';\n    var d = document.createElement('div');\n    d.textContent = s;\n    return d.innerHTML;\n  }\n\n  function formatDate(ds) {\n    var d = new Date(ds);\n    return ('0'+d.getDate()).slice(-2) + '.' + ('0'+(d.getMonth()+1)).slice(-2) + '.' + d.getFullYear();\n  }\n\n  function getDateClass(ds) {\n    var diff = Math.ceil((new Date(ds) - new Date().setHours(0,0,0,0)) / 86400000);\n    if (diff < 0) return 'expired';\n    if (diff <= 7) return 'critical';\n    if (diff <= 30) return 'warning';\n    if (diff <= 90) return 'soon';\n    return 'ok';\n  }\n\n  function loadData() {\n    var search = document.getElementById('filter-search').value;\n    var mc = document.getElementById('filter-medcenter').value;\n    var sp = document.getElementById('filter-specialty').value;\n    \n    var url = API_URL + '?sortBy=' + sortField + '&sortOrder=' + sortOrder;\n    if (search) url += '&search=' + encodeURIComponent(search);\n    if (mc) url += '&medCenter=' + encodeURIComponent(mc);\n    if (sp) url += '&specialty=' + encodeURIComponent(sp);\n\n    fetchAPI(url).then(function(data) {\n      accreditations = data;\n      if (currentPage > Math.ceil(accreditations.length / pageSize)) {\n        currentPage = 1;\n      }\n      renderTable();\n      renderPagination();\n      loadStats();\n    }).catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function loadStats() {\n    fetchAPI(API_URL + '/stats').then(function(s) {\n      document.getElementById('stat-total').textContent = s.total;\n      document.getElementById('stat-expired').textContent = s.expired;\n      document.getElementById('stat-soon').textContent = s.expiringSoon;\n      document.getElementById('stat-90').textContent = s.expiringIn90;\n    });\n  }\n\n  function loadSpecialties() {\n    fetchAPI(API_URL + '/specialties').then(function(list) {\n      var sel = document.getElementById('filter-specialty');\n      var dl = document.getElementById('specialties-list');\n      sel.innerHTML = '<option value="">Все специальности</option>' + list.map(function(s) {\n        return '<option value="'+s+'">'+s+'</option>';\n      }).join('');\n      dl.innerHTML = list.map(function(s) { return '<option value="'+s+'">'; }).join('');\n    });\n  }\n\n  function renderTable() {\n    var tb = document.getElementById('acc-table-body');\n    if (!accreditations.length) {\n      tb.innerHTML = '<tr><td colspan="6" class="acc-empty">Нет данных</td></tr>';\n      return;\n    }\n    var start = (currentPage - 1) * pageSize;\n    var end = start + pageSize;\n    var pageData = accreditations.slice(start, end);\n    \n    tb.innerHTML = pageData.map(function(a) {\n      var isHighlighted = highlightId && a.id === highlightId;\n      return '<tr data-id="' + a.id + '"' + (isHighlighted ? ' class="acc-highlight"' : '') + '>' +\n        '<td><span class="acc-medcenter" data-center="'+a.medCenter+'">'+a.medCenter+'</span></td>' +\n        '<td><strong>'+escapeHtml(a.fullName)+'</strong></td>' +\n        '<td>'+escapeHtml(a.specialty)+'</td>' +\n        '<td><span class="acc-date '+getDateClass(a.expirationDate)+'">'+formatDate(a.expirationDate)+'</span></td>' +\n        '<td>'+escapeHtml(a.comment||'—')+'</td>' +\n        '<td style="text-align:center"><div class="acc-actions" style="justify-content:center">' +\n          '<button class="acc-btn acc-btn-icon acc-btn-edit" onclick="accApp.openEditModal(\\''+a.id+'\\')" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +\n          '<button class="acc-btn acc-btn-icon acc-btn-delete" onclick="accApp.deleteRecord(\\''+a.id+'\\')" title="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +\n        '</div></td></tr>';\n    }).join('');\n\n    if (highlightId) {\n      setTimeout(function() { highlightId = null; }, 3000);\n    }\n  }\n\n  function renderPagination() {\n    var pagination = document.getElementById('acc-pagination');\n    var info = document.getElementById('pagination-info');\n    var controls = document.getElementById('pagination-controls');\n    var total = accreditations.length;\n    var totalPages = Math.ceil(total / pageSize);\n    \n    if (total <= pageSize) {\n      pagination.style.display = 'none';\n      return;\n    }\n    \n    pagination.style.display = 'flex';\n    \n    var start = (currentPage - 1) * pageSize + 1;\n    var end = Math.min(currentPage * pageSize, total);\n    info.textContent = 'Показано ' + start + '-' + end + ' из ' + total;\n    \n    var html = '';\n    html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';\n    \n    var startPage = Math.max(1, currentPage - 2);\n    var endPage = Math.min(totalPages, startPage + 4);\n    if (endPage - startPage < 4) {\n      startPage = Math.max(1, endPage - 4);\n    }\n    \n    if (startPage > 1) {\n      html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(1)">1</button>';\n      if (startPage > 2) html += '<span style="color:#9ca3af">...</span>';\n    }\n    \n    for (var i = startPage; i <= endPage; i++) {\n      html += '<button class="acc-pagination-btn ' + (i === currentPage ? 'active' : '') + '" onclick="accApp.goToPage(' + i + ')">' + i + '</button>';\n    }\n    \n    if (endPage < totalPages) {\n      if (endPage < totalPages - 1) html += '<span style="color:#9ca3af">...</span>';\n      html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(' + totalPages + ')">' + totalPages + '</button>';\n    }\n    \n    html += '<button class="acc-pagination-btn" onclick="accApp.goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>';\n    \n    controls.innerHTML = html;\n  }\n\n  function goToPage(page) {\n    var totalPages = Math.ceil(accreditations.length / pageSize);\n    if (page < 1 || page > totalPages) return;\n    currentPage = page;\n    renderTable();\n    renderPagination();\n    document.querySelector('.acc-table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });\n  }\n\n  function scrollToRecord(id) {\n    var index = -1;\n    for (var i = 0; i < accreditations.length; i++) {\n      if (accreditations[i].id === id) { index = i; break; }\n    }\n    if (index === -1) return false;\n    \n    highlightId = id;\n    currentPage = Math.floor(index / pageSize) + 1;\n    renderTable();\n    renderPagination();\n    \n    setTimeout(function() {\n      var row = document.querySelector('tr[data-id="' + id + '"]');\n      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });\n    }, 100);\n    return true;\n  }\n\n  function openAddModal() {\n    document.getElementById('modal-title').textContent = 'Добавить запись';\n    document.getElementById('edit-id').value = '';\n    document.getElementById('acc-form').reset();\n    document.getElementById('acc-modal').style.display = 'flex';\n  }\n\n  function openEditModal(id) {\n    var a = accreditations.find(function(x) { return x.id === id; });\n    if (!a) return;\n    document.getElementById('modal-title').textContent = 'Редактировать';\n    document.getElementById('edit-id').value = a.id;\n    document.getElementById('edit-medcenter').value = a.medCenter;\n    document.getElementById('edit-fullname').value = a.fullName;\n    document.getElementById('edit-specialty').value = a.specialty;\n    document.getElementById('edit-expdate').value = a.expirationDate;\n    document.getElementById('edit-comment').value = a.comment || '';\n    document.getElementById('acc-modal').style.display = 'flex';\n  }\n\n  function closeModal() {\n    document.getElementById('acc-modal').style.display = 'none';\n  }\n\n  function saveRecord(e) {\n    e.preventDefault();\n    var id = document.getElementById('edit-id').value;\n    var data = {\n      medCenter: document.getElementById('edit-medcenter').value,\n      fullName: document.getElementById('edit-fullname').value,\n      specialty: document.getElementById('edit-specialty').value,\n      expirationDate: document.getElementById('edit-expdate').value,\n      comment: document.getElementById('edit-comment').value\n    };\n    var url = id ? API_URL + '/' + id : API_URL;\n    fetchAPI(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })\n      .then(function() {\n        showToast(id ? 'Обновлено' : 'Добавлено', 'success');\n        closeModal();\n        loadData();\n        loadSpecialties();\n      }).catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function deleteRecord(id) {\n    if (!confirm('Удалить запись?')) return;\n    fetchAPI(API_URL + '/' + id, { method: 'DELETE' })\n      .then(function() {\n        showToast('Удалено', 'success');\n        loadData();\n        loadSpecialties();\n      }).catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function sortTable(field) {\n    if (sortField === field) {\n      sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';\n    } else {\n      sortField = field;\n      sortOrder = 'ASC';\n    }\n    currentPage = 1;\n    loadData();\n  }\n\n  function debounceLoad() {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(function() {\n      currentPage = 1;\n      loadData();\n    }, 300);\n  }\n\n  function resetAndLoad() {\n    currentPage = 1;\n    loadData();\n  }\n\n  // Init\n  if (!getToken()) {\n    document.getElementById('accreditations-app').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">Необходима авторизация</div>';\n  } else {\n    var urlParams = new URLSearchParams(window.location.search);\n    var highlightParam = urlParams.get('highlight');\n    \n    loadData();\n    loadSpecialties();\n    \n    if (highlightParam) {\n      var checkAndScroll = setInterval(function() {\n        if (accreditations.length > 0) {\n          clearInterval(checkAndScroll);\n          scrollToRecord(highlightParam);\n          window.history.replaceState({}, '', window.location.pathname);\n        }\n      }, 100);\n      setTimeout(function() { clearInterval(checkAndScroll); }, 5000);\n    }\n    \n    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });\n  }\n\n  return {\n    loadData: loadData,\n    openAddModal: openAddModal,\n    openEditModal: openEditModal,\n    closeModal: closeModal,\n    saveRecord: saveRecord,\n    deleteRecord: deleteRecord,\n    sortTable: sortTable,\n    debounceLoad: debounceLoad,\n    resetAndLoad: resetAndLoad,\n    goToPage: goToPage,\n    scrollToRecord: scrollToRecord\n  };\n})();\n</script>	html		{}	Telegram-бот напоминаний Подпишитесь на бота, чтобы получать уведомления об истечении сроков аккредитаций за 90, 60, 30, 14 и 7 дней. @alfa_appointments_bot 0Всего 0Просрочено 0Истекает ≤30 дней 0Истекает ≤90 дней Добавить Медцентр ↕ ФИО ↕ Специальность ↕ Срок действия ↕ Комментарий Действия Загрузка... Показано 1-20 из 100 Добавить запись × Медцентр * ФИО * Специальность * Срок действия * Комментарий Отмена Сохранить	file-text	\N	1	f	f	{}			{}	2026-01-01 16:49:50.138+03	2026-01-01 22:45:17.962+03	73e7e5ea-13eb-4509-bed7-441541ed1447	73e7e5ea-13eb-4509-bed7-441541ed1447
27dcbafb-81a3-4087-84d3-f0da8bb9b817	map	Карта	<style>\n#map-app {\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n  max-width: 100%;\n  margin: 0 auto;\n}\n\n.map-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 16px;\n  flex-wrap: wrap;\n  gap: 12px;\n}\n\n.map-header h2 {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  font-size: 22px;\n  font-weight: 600;\n  color: #1f2937;\n  margin: 0;\n}\n\n.map-hint {\n  font-size: 13px;\n  color: #6b7280;\n  background: #f3f4f6;\n  padding: 6px 14px;\n  border-radius: 20px;\n}\n\n.map-container {\n  position: relative;\n  border-radius: 16px;\n  overflow: hidden;\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);\n  border: 1px solid #e5e7eb;\n}\n\n#map {\n  height: 600px;\n  width: 100%;\n  z-index: 1;\n}\n\n.leaflet-control-attribution { display: none !important; }\n\n/* Легенда */\n.map-legend {\n  position: absolute;\n  bottom: 20px;\n  left: 20px;\n  background: #fff;\n  padding: 14px 16px;\n  border-radius: 12px;\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);\n  z-index: 1000;\n  max-width: 220px;\n  transition: all 0.3s ease;\n}\n\n.map-legend.collapsed { padding: 10px 14px; }\n\n.legend-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  cursor: pointer;\n  font-weight: 600;\n  font-size: 14px;\n  color: #1f2937;\n  user-select: none;\n}\n\n.legend-header svg { width: 16px; height: 16px; }\n.legend-header svg:last-child { margin-left: auto; opacity: 0.5; }\n\n.legend-items { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }\n\n.legend-item { display: flex; align-items: center; gap: 10px; }\n\n.legend-color { width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; }\n\n.legend-label { font-size: 13px; color: #4b5563; flex: 1; }\n\n.legend-count {\n  font-size: 12px;\n  font-weight: 600;\n  color: #9ca3af;\n  background: #f3f4f6;\n  padding: 2px 8px;\n  border-radius: 10px;\n}\n\n/* Модальное окно */\n.map-modal {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.5);\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  z-index: 10000;\n  backdrop-filter: blur(4px);\n}\n\n.map-modal.hidden { display: none; }\n\n.map-modal-content {\n  background: #fff;\n  border-radius: 20px;\n  width: 100%;\n  max-width: 480px;\n  max-height: 90vh;\n  display: flex;\n  flex-direction: column;\n  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);\n  margin: 16px;\n  animation: modalSlideIn 0.3s ease;\n}\n\n@keyframes modalSlideIn {\n  from { opacity: 0; transform: translateY(-20px) scale(0.95); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}\n\n.map-modal-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 20px 24px;\n  border-bottom: 1px solid #e5e7eb;\n}\n\n.map-modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; color: #1f2937; }\n\n.map-modal-close {\n  width: 32px; height: 32px;\n  border: none; background: #f3f4f6;\n  border-radius: 8px; font-size: 20px;\n  cursor: pointer; color: #6b7280;\n  display: flex; align-items: center; justify-content: center;\n}\n.map-modal-close:hover { background: #e5e7eb; }\n\n.map-modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }\n\n.map-form-group { margin-bottom: 18px; }\n.map-form-group:last-child { margin-bottom: 0; }\n\n.map-form-group label {\n  display: block;\n  font-size: 13px;\n  font-weight: 500;\n  color: #4b5563;\n  margin-bottom: 8px;\n}\n\n.map-input, .map-textarea {\n  width: 100%;\n  padding: 12px 14px;\n  border: 1px solid #d1d5db;\n  border-radius: 10px;\n  font-size: 14px;\n  transition: all 0.2s;\n  background: #fff;\n  color: #1f2937;\n  box-sizing: border-box;\n}\n\n.map-input:focus, .map-textarea:focus {\n  outline: none;\n  border-color: #3b82f6;\n  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);\n}\n\n.map-textarea { resize: vertical; min-height: 80px; }\n\n/* Выбор цвета */\n.color-picker { display: flex; flex-wrap: wrap; gap: 8px; }\n\n.color-btn {\n  width: 32px; height: 32px;\n  border-radius: 8px;\n  border: 2px solid transparent;\n  cursor: pointer;\n  transition: all 0.2s;\n  position: relative;\n}\n\n.color-btn:hover { transform: scale(1.1); }\n\n.color-btn.active {\n  border-color: #1f2937;\n  box-shadow: 0 0 0 2px white, 0 0 0 4px #1f2937;\n}\n\n.color-btn.active::after {\n  content: '✓';\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: white;\n  font-size: 14px;\n  font-weight: bold;\n  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);\n}\n\n.selected-category {\n  margin-top: 10px;\n  font-size: 12px;\n  color: #6b7280;\n  padding: 6px 12px;\n  background: #f3f4f6;\n  border-radius: 8px;\n}\n\n/* Загрузка файлов */\n.upload-area {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 16px;\n  background: #f9fafb;\n  border: 2px dashed #d1d5db;\n  border-radius: 10px;\n  cursor: pointer;\n  font-size: 14px;\n  color: #6b7280;\n  transition: all 0.2s;\n}\n\n.upload-area:hover {\n  border-color: #3b82f6;\n  color: #3b82f6;\n  background: #eff6ff;\n}\n\n.upload-area svg { width: 18px; height: 18px; }\n\n.media-preview {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));\n  gap: 10px;\n  margin-top: 12px;\n}\n\n.preview-item {\n  position: relative;\n  aspect-ratio: 1;\n  border-radius: 10px;\n  overflow: hidden;\n  background: #f3f4f6;\n}\n\n.preview-item.new { border: 2px solid #3b82f6; }\n\n.preview-item img, .preview-item video {\n  width: 100%; height: 100%; object-fit: cover;\n}\n\n.preview-item .remove-btn {\n  position: absolute;\n  top: 4px; right: 4px;\n  width: 22px; height: 22px;\n  border-radius: 50%;\n  background: rgba(0, 0, 0, 0.7);\n  border: none;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: white;\n  font-size: 14px;\n  opacity: 0;\n  transition: opacity 0.2s;\n}\n\n.preview-item:hover .remove-btn { opacity: 1; }\n\n.map-modal-footer {\n  display: flex;\n  justify-content: flex-end;\n  gap: 10px;\n  padding: 16px 24px;\n  border-top: 1px solid #e5e7eb;\n  background: #f9fafb;\n  border-radius: 0 0 20px 20px;\n}\n\n/* Кнопки */\n.map-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  padding: 10px 18px;\n  border-radius: 10px;\n  font-size: 14px;\n  font-weight: 500;\n  cursor: pointer;\n  transition: all 0.2s;\n  border: none;\n}\n\n.map-btn svg { width: 16px; height: 16px; }\n\n.map-btn-primary {\n  background: linear-gradient(135deg, #3b82f6, #2563eb);\n  color: white;\n}\n.map-btn-primary:hover { background: linear-gradient(135deg, #2563eb, #1d4ed8); }\n.map-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }\n\n.map-btn-secondary { background: #f3f4f6; color: #374151; }\n.map-btn-secondary:hover { background: #e5e7eb; }\n\n.map-btn-danger { background: #fee2e2; color: #dc2626; }\n.map-btn-danger:hover { background: #fecaca; }\n\n/* Боковая панель */\n.map-sidebar {\n  position: fixed;\n  top: 0; right: 0;\n  width: 400px;\n  height: 100vh;\n  background: #fff;\n  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);\n  z-index: 10001;\n  transform: translateX(100%);\n  transition: transform 0.3s ease;\n  display: flex;\n  flex-direction: column;\n}\n\n.map-sidebar.open { transform: translateX(0); }\n\n.sidebar-close {\n  position: absolute;\n  top: 16px; right: 16px;\n  width: 36px; height: 36px;\n  background: #f3f4f6;\n  border: none;\n  border-radius: 10px;\n  cursor: pointer;\n  font-size: 20px;\n  color: #6b7280;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 1;\n}\n.sidebar-close:hover { background: #e5e7eb; color: #1f2937; }\n\n.sidebar-content { padding: 24px; overflow-y: auto; flex: 1; }\n\n.sidebar-header {\n  display: flex;\n  align-items: flex-start;\n  gap: 12px;\n  margin-bottom: 16px;\n  padding-right: 40px;\n}\n\n.marker-color-badge {\n  width: 18px; height: 18px;\n  border-radius: 5px;\n  flex-shrink: 0;\n  margin-top: 4px;\n}\n\n.sidebar-header h3 {\n  margin: 0;\n  font-size: 20px;\n  font-weight: 600;\n  color: #1f2937;\n  line-height: 1.3;\n}\n\n.sidebar-description {\n  font-size: 14px;\n  color: #4b5563;\n  line-height: 1.6;\n  margin-bottom: 16px;\n  white-space: pre-wrap;\n}\n\n.sidebar-category {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 13px;\n  color: #6b7280;\n  background: #f3f4f6;\n  padding: 6px 14px;\n  border-radius: 20px;\n  margin-bottom: 16px;\n}\n\n.sidebar-media {\n  display: grid;\n  grid-template-columns: repeat(2, 1fr);\n  gap: 10px;\n  margin-bottom: 16px;\n}\n\n.media-item {\n  position: relative;\n  aspect-ratio: 4/3;\n  border-radius: 12px;\n  overflow: hidden;\n  cursor: pointer;\n  background: #f3f4f6;\n}\n\n.media-item img, .media-item video {\n  width: 100%; height: 100%;\n  object-fit: cover;\n  transition: transform 0.3s;\n}\n\n.media-item:hover img, .media-item:hover video { transform: scale(1.05); }\n\n.video-overlay {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(0, 0, 0, 0.35);\n  color: white;\n}\n\n.video-overlay svg { width: 32px; height: 32px; }\n\n.sidebar-meta {\n  font-size: 12px;\n  color: #9ca3af;\n  padding-top: 12px;\n  border-top: 1px solid #e5e7eb;\n  margin-bottom: 16px;\n}\n\n.sidebar-actions {\n  display: flex;\n  gap: 10px;\n  margin-top: auto;\n  padding-top: 16px;\n}\n\n.sidebar-actions button { flex: 1; }\n\n/* Просмотр медиа */\n.media-viewer {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.95);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 10002;\n  cursor: pointer;\n}\n\n.media-viewer.hidden { display: none; }\n\n.viewer-close {\n  position: absolute;\n  top: 20px; right: 20px;\n  background: none;\n  border: none;\n  color: white;\n  cursor: pointer;\n  font-size: 32px;\n  opacity: 0.7;\n}\n.viewer-close:hover { opacity: 1; }\n\n.viewer-content { max-width: 90vw; max-height: 90vh; cursor: default; }\n\n.viewer-content img, .viewer-content video {\n  max-width: 100%;\n  max-height: 90vh;\n  border-radius: 12px;\n}\n\n/* Toast */\n.map-toast {\n  position: fixed;\n  bottom: 24px;\n  right: 24px;\n  padding: 14px 20px;\n  background: #1f2937;\n  color: #fff;\n  border-radius: 12px;\n  font-size: 14px;\n  opacity: 0;\n  transform: translateY(20px);\n  transition: all 0.3s;\n  z-index: 10003;\n  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);\n}\n.map-toast.show { opacity: 1; transform: translateY(0); }\n.map-toast.success { background: #059669; }\n.map-toast.error { background: #dc2626; }\n\n/* Responsive */\n@media (max-width: 768px) {\n  #map { height: 500px; }\n  \n  .map-header { flex-direction: column; align-items: flex-start; }\n  \n  .map-sidebar { width: 100%; }\n  \n  .map-modal-content { max-width: calc(100% - 32px); }\n  \n  .map-legend { bottom: 12px; left: 12px; max-width: 180px; padding: 10px 12px; }\n  \n  .legend-items { gap: 6px; }\n  .legend-label { font-size: 12px; }\n  \n  .sidebar-media { grid-template-columns: 1fr; }\n}\n\n@media (max-width: 480px) {\n  #map { height: 400px; }\n  \n  .map-header h2 { font-size: 18px; }\n  \n  .color-picker { gap: 6px; }\n  .color-btn { width: 28px; height: 28px; }\n}\n</style>\n\n<div id="map-app">\n  <div class="map-header">\n    <h2>\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">\n        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>\n        <circle cx="12" cy="10" r="3"/>\n      </svg>\n      Интерактивная карта\n    </h2>\n    <span class="map-hint">Нажмите на карту, чтобы добавить метку</span>\n  </div>\n\n  <div class="map-container">\n    <div id="map"></div>\n    \n    <div class="map-legend" id="mapLegend">\n      <div class="legend-header" onclick="mapApp.toggleLegend()">\n        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>\n        <span>Легенда</span>\n        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="legendChevron"><polyline points="15 18 9 12 15 6"/></svg>\n      </div>\n      <div class="legend-items" id="legendItems"></div>\n    </div>\n  </div>\n\n  <!-- Модальное окно -->\n  <div id="markerModal" class="map-modal hidden">\n    <div class="map-modal-content">\n      <div class="map-modal-header">\n        <h3 id="modalTitle">Добавить метку</h3>\n        <button class="map-modal-close" onclick="mapApp.closeModal()">×</button>\n      </div>\n      <div class="map-modal-body">\n        <div class="map-form-group">\n          <label>Название *</label>\n          <input type="text" id="markerTitle" class="map-input" placeholder="Введите название">\n        </div>\n        <div class="map-form-group">\n          <label>Описание</label>\n          <textarea id="markerDesc" class="map-textarea" placeholder="Введите описание" rows="3"></textarea>\n        </div>\n        <div class="map-form-group">\n          <label>Цвет / Категория</label>\n          <div class="color-picker" id="colorPicker"></div>\n          <div class="selected-category" id="selectedCategory" style="display:none"></div>\n        </div>\n        <div class="map-form-group">\n          <label>Медиа файлы</label>\n          <label class="upload-area">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>\n            Загрузить файлы\n            <input type="file" id="markerFiles" multiple accept="image/*,video/*" style="display:none" onchange="mapApp.handleFiles(event)">\n          </label>\n          <div class="media-preview" id="previewContainer"></div>\n        </div>\n      </div>\n      <div class="map-modal-footer">\n        <button class="map-btn map-btn-secondary" onclick="mapApp.closeModal()">Отмена</button>\n        <button class="map-btn map-btn-primary" id="saveBtn" onclick="mapApp.saveMarker()">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>\n          Сохранить\n        </button>\n      </div>\n    </div>\n  </div>\n\n  <!-- Боковая панель -->\n  <div id="markerSidebar" class="map-sidebar">\n    <button class="sidebar-close" onclick="mapApp.closeSidebar()">×</button>\n    <div class="sidebar-content" id="sidebarContent"></div>\n  </div>\n\n  <!-- Просмотр медиа -->\n  <div id="mediaViewer" class="media-viewer hidden" onclick="mapApp.closeViewer()">\n    <button class="viewer-close">×</button>\n    <div class="viewer-content" id="viewerContent" onclick="event.stopPropagation()"></div>\n  </div>\n\n  <div id="mapToast" class="map-toast"></div>\n</div>\n\n<script>\nwindow.mapApp = (function() {\n  var API_BASE = window.location.protocol + '//' + window.location.hostname + ':9001';\n  var API_URL = API_BASE + '/api/map';\n  \n  var map = null;\n  var markersLayer = null;\n  var markers = [];\n  var currentLatLng = null;\n  var currentColor = '#4a90e2';\n  var editingMarker = null;\n  var selectedFiles = [];\n  var existingMedia = [];\n  var legendCollapsed = false;\n\n  // Категории по цветам\n  var colorToCategory = {\n    "#ff4d4d": "Экраны",\n    "#ff6f00": "Партнёрские рекламы",\n    "#cddc39": "Наши экраны",\n    "#1abc9c": "Остановки",\n    "#7e57c2": "Навигация",\n    "#ff80ab": "Фасады",\n    "#9e9e9e": "Сити формат",\n    "#4a90e2": "Прочее"\n  };\n\n  var colorPalette = [\n    "#ff4d4d", "#ff80ab", "#ff6f00", "#ffa726", "#ffd54f",\n    "#f4d03f", "#cddc39", "#8bc34a", "#00bfa5", "#2ecc71",\n    "#1abc9c", "#4a90e2", "#3498db", "#34495e", "#7e57c2",\n    "#ba68c8", "#8e44ad", "#7f5b3a", "#555555", "#9e9e9e"\n  ];\n\n  function getToken() {\n    return localStorage.getItem('token');\n  }\n\n  function fetchAPI(url, options) {\n    options = options || {};\n    var headers = { 'Authorization': 'Bearer ' + getToken() };\n    if (!(options.body instanceof FormData)) {\n      headers['Content-Type'] = 'application/json';\n    }\n    return fetch(url, {\n      method: options.method || 'GET',\n      headers: headers,\n      body: options.body\n    }).then(function(r) {\n      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Error'); });\n      return r.json();\n    });\n  }\n\n  function showToast(msg, type) {\n    var t = document.getElementById('mapToast');\n    t.textContent = msg;\n    t.className = 'map-toast show ' + (type || '');\n    setTimeout(function() { t.className = 'map-toast'; }, 3000);\n  }\n\n  function createColorIcon(color) {\n    color = color || '#4a90e2';\n    var svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46"><path d="M18 0C11.163 0 5.5 5.663 5.5 12.5 5.5 22.125 18 46 18 46s12.5-23.875 12.5-33.5C30.5 5.663 24.837 0 18 0z" fill="' + color + '"/><circle cx="18" cy="12.5" r="5.5" fill="#fff" opacity="0.9"/></svg>');\n    return L.icon({\n      iconUrl: 'data:image/svg+xml;charset=UTF-8,' + svg,\n      iconSize: [36, 46],\n      iconAnchor: [18, 46],\n      popupAnchor: [0, -40]\n    });\n  }\n\n  function initColorPicker() {\n    var picker = document.getElementById('colorPicker');\n    picker.innerHTML = colorPalette.map(function(color) {\n      var active = color === currentColor ? 'active' : '';\n      var title = colorToCategory[color] || color;\n      return '<button class="color-btn ' + active + '" style="background:' + color + '" data-color="' + color + '" title="' + title + '" onclick="mapApp.selectColor(\\'' + color + '\\')"></button>';\n    }).join('');\n    updateCategoryDisplay();\n  }\n\n  function selectColor(color) {\n    currentColor = color;\n    document.querySelectorAll('.color-btn').forEach(function(btn) {\n      btn.classList.toggle('active', btn.dataset.color === color);\n    });\n    updateCategoryDisplay();\n  }\n\n  function updateCategoryDisplay() {\n    var catEl = document.getElementById('selectedCategory');\n    if (colorToCategory[currentColor]) {\n      catEl.textContent = 'Категория: ' + colorToCategory[currentColor];\n      catEl.style.display = 'block';\n    } else {\n      catEl.style.display = 'none';\n    }\n  }\n\n  function loadMarkers() {\n    fetchAPI(API_URL + '/markers').then(function(data) {\n      markers = data;\n      renderMarkers();\n      updateLegend();\n    }).catch(function(e) {\n      showToast('Ошибка загрузки: ' + e.message, 'error');\n    });\n  }\n\n  function renderMarkers() {\n    if (!markersLayer) return;\n    markersLayer.clearLayers();\n    markers.forEach(function(m) {\n      var color = m.color || '#4a90e2';\n      var marker = L.marker([m.lat, m.lng], { icon: createColorIcon(color) });\n      marker.on('click', function() { openSidebar(m); });\n      markersLayer.addLayer(marker);\n    });\n  }\n\n  function updateLegend() {\n    var stats = {};\n    markers.forEach(function(m) {\n      var color = m.color || '#4a90e2';\n      stats[color] = (stats[color] || 0) + 1;\n    });\n\n    var html = Object.keys(colorToCategory).map(function(color) {\n      return '<div class="legend-item">' +\n        '<div class="legend-color" style="background:' + color + '"></div>' +\n        '<span class="legend-label">' + colorToCategory[color] + '</span>' +\n        '<span class="legend-count">' + (stats[color] || 0) + '</span>' +\n      '</div>';\n    }).join('');\n\n    document.getElementById('legendItems').innerHTML = html;\n  }\n\n  function toggleLegend() {\n    legendCollapsed = !legendCollapsed;\n    var legend = document.getElementById('mapLegend');\n    var items = document.getElementById('legendItems');\n    var chevron = document.getElementById('legendChevron');\n    \n    legend.classList.toggle('collapsed', legendCollapsed);\n    items.style.display = legendCollapsed ? 'none' : 'flex';\n    chevron.innerHTML = legendCollapsed \n      ? '<polyline points="9 18 15 12 9 6"/>'\n      : '<polyline points="15 18 9 12 15 6"/>';\n  }\n\n  function openModal(latlng, marker) {\n    currentLatLng = latlng;\n    editingMarker = marker || null;\n    selectedFiles = [];\n    existingMedia = marker ? (marker.media || []) : [];\n    \n    document.getElementById('modalTitle').textContent = marker ? 'Редактировать метку' : 'Добавить метку';\n    document.getElementById('markerTitle').value = marker ? marker.title : '';\n    document.getElementById('markerDesc').value = marker ? (marker.description || '') : '';\n    \n    currentColor = marker ? (marker.color || '#4a90e2') : '#4a90e2';\n    initColorPicker();\n    renderPreview();\n    \n    document.getElementById('markerModal').classList.remove('hidden');\n  }\n\n  function closeModal() {\n    document.getElementById('markerModal').classList.add('hidden');\n    selectedFiles = [];\n    existingMedia = [];\n    editingMarker = null;\n  }\n\n  function handleFiles(e) {\n    var files = Array.from(e.target.files);\n    selectedFiles = selectedFiles.concat(files);\n    renderPreview();\n    e.target.value = '';\n  }\n\n  function removeFile(index, isExisting) {\n    if (isExisting) {\n      existingMedia.splice(index, 1);\n    } else {\n      selectedFiles.splice(index, 1);\n    }\n    renderPreview();\n  }\n\n  function renderPreview() {\n    var container = document.getElementById('previewContainer');\n    var html = '';\n\n    existingMedia.forEach(function(path, i) {\n      var url = getMediaUrl(path);\n      var isVideo = /\\.(mp4|webm|ogg)$/i.test(path);\n      html += '<div class="preview-item">';\n      html += isVideo \n        ? '<video src="' + url + '"></video>'\n        : '<img src="' + url + '">';\n      html += '<button class="remove-btn" onclick="mapApp.removeFile(' + i + ', true)">×</button></div>';\n    });\n\n    selectedFiles.forEach(function(file, i) {\n      var url = URL.createObjectURL(file);\n      var isVideo = file.type.startsWith('video');\n      html += '<div class="preview-item new">';\n      html += isVideo \n        ? '<video src="' + url + '"></video>'\n        : '<img src="' + url + '">';\n      html += '<button class="remove-btn" onclick="mapApp.removeFile(' + i + ', false)">×</button></div>';\n    });\n\n    container.innerHTML = html;\n  }\n\n  function getMediaUrl(path) {\n    if (path.startsWith('http')) return path;\n    return API_BASE + path;\n  }\n\n  function saveMarker() {\n    var title = document.getElementById('markerTitle').value.trim();\n    if (!title) {\n      showToast('Введите название', 'error');\n      return;\n    }\n\n    var btn = document.getElementById('saveBtn');\n    btn.disabled = true;\n    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Сохранение...';\n\n    var uploadPromise;\n    if (selectedFiles.length > 0) {\n      var formData = new FormData();\n      selectedFiles.forEach(function(f) { formData.append('files', f); });\n      uploadPromise = fetchAPI(API_URL + '/upload', { method: 'POST', body: formData });\n    } else {\n      uploadPromise = Promise.resolve({ files: [] });\n    }\n\n    uploadPromise.then(function(uploadRes) {\n      var mediaList = existingMedia.concat(uploadRes.files || []);\n      var data = {\n        lat: editingMarker ? editingMarker.lat : currentLatLng.lat,\n        lng: editingMarker ? editingMarker.lng : currentLatLng.lng,\n        title: title,\n        description: document.getElementById('markerDesc').value.trim(),\n        color: currentColor,\n        media: mediaList,\n        category: colorToCategory[currentColor] || null\n      };\n\n      var url = editingMarker \n        ? API_URL + '/markers/' + editingMarker.id \n        : API_URL + '/markers';\n      var method = editingMarker ? 'PUT' : 'POST';\n\n      return fetchAPI(url, { method: method, body: JSON.stringify(data) });\n    }).then(function() {\n      showToast(editingMarker ? 'Метка обновлена' : 'Метка создана', 'success');\n      closeModal();\n      closeSidebar();\n      loadMarkers();\n    }).catch(function(e) {\n      showToast('Ошибка: ' + e.message, 'error');\n    }).finally(function() {\n      btn.disabled = false;\n      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Сохранить';\n    });\n  }\n\n  function openSidebar(marker) {\n    var sidebar = document.getElementById('markerSidebar');\n    var content = document.getElementById('sidebarContent');\n    \n    var mediaHtml = '';\n    if (marker.media && marker.media.length > 0) {\n      mediaHtml = '<div class="sidebar-media">' + marker.media.map(function(path, i) {\n        var url = getMediaUrl(path);\n        var isVideo = /\\.(mp4|webm|ogg)$/i.test(path);\n        return '<div class="media-item" onclick="mapApp.openViewer(\\'' + url + '\\', ' + isVideo + ')">' +\n          (isVideo \n            ? '<video src="' + url + '"></video><div class="video-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>'\n            : '<img src="' + url + '">') +\n        '</div>';\n      }).join('') + '</div>';\n    }\n\n    var creatorInfo = marker.creator \n      ? '<div class="sidebar-meta">Создал: ' + (marker.creator.displayName || marker.creator.username) + '</div>'\n      : '';\n\n    content.innerHTML = \n      '<div class="sidebar-header">' +\n        '<div class="marker-color-badge" style="background:' + (marker.color || '#4a90e2') + '"></div>' +\n        '<h3>' + escapeHtml(marker.title) + '</h3>' +\n      '</div>' +\n      (marker.description ? '<p class="sidebar-description">' + escapeHtml(marker.description) + '</p>' : '') +\n      (marker.category ? '<div class="sidebar-category"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' + marker.category + '</div>' : '') +\n      mediaHtml +\n      creatorInfo +\n      '<div class="sidebar-actions">' +\n        '<button class="map-btn map-btn-primary" onclick="mapApp.editMarker(\\'' + marker.id + '\\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Редактировать</button>' +\n        '<button class="map-btn map-btn-danger" onclick="mapApp.deleteMarker(\\'' + marker.id + '\\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Удалить</button>' +\n      '</div>';\n\n    sidebar.classList.add('open');\n    \n    // Сохраняем текущий маркер для редактирования\n    sidebar.dataset.markerId = marker.id;\n  }\n\n  function closeSidebar() {\n    document.getElementById('markerSidebar').classList.remove('open');\n  }\n\n  function editMarker(id) {\n    var marker = markers.find(function(m) { return m.id === id; });\n    if (marker) {\n      closeSidebar();\n      openModal({ lat: marker.lat, lng: marker.lng }, marker);\n    }\n  }\n\n  function deleteMarker(id) {\n    if (!confirm('Вы уверены, что хотите удалить метку?')) return;\n    \n    fetchAPI(API_URL + '/markers/' + id, { method: 'DELETE' })\n      .then(function() {\n        showToast('Метка удалена', 'success');\n        closeSidebar();\n        loadMarkers();\n      })\n      .catch(function(e) {\n        showToast('Ошибка: ' + e.message, 'error');\n      });\n  }\n\n  function openViewer(url, isVideo) {\n    var viewer = document.getElementById('mediaViewer');\n    var content = document.getElementById('viewerContent');\n    \n    content.innerHTML = isVideo\n      ? '<video src="' + url + '" controls autoplay></video>'\n      : '<img src="' + url + '">';\n    \n    viewer.classList.remove('hidden');\n  }\n\n  function closeViewer() {\n    document.getElementById('mediaViewer').classList.add('hidden');\n    document.getElementById('viewerContent').innerHTML = '';\n  }\n\n  function escapeHtml(s) {\n    if (!s) return '';\n    var d = document.createElement('div');\n    d.textContent = s;\n    return d.innerHTML;\n  }\n\n  function init() {\n    if (!getToken()) {\n      document.getElementById('map-app').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">Необходима авторизация</div>';\n      return;\n    }\n\n    // Загрузка Leaflet\n    if (window.L) {\n      initMap();\n    } else {\n      var css = document.createElement('link');\n      css.rel = 'stylesheet';\n      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';\n      document.head.appendChild(css);\n\n      var script = document.createElement('script');\n      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';\n      script.onload = initMap;\n      document.body.appendChild(script);\n    }\n\n    // Закрытие по Escape\n    document.addEventListener('keydown', function(e) {\n      if (e.key === 'Escape') {\n        closeModal();\n        closeSidebar();\n        closeViewer();\n      }\n    });\n\n    // Проверка URL параметров для подсветки маркера\n    var urlParams = new URLSearchParams(window.location.search);\n    var highlightId = urlParams.get('marker');\n    if (highlightId) {\n      var checkMarker = setInterval(function() {\n        if (markers.length > 0) {\n          clearInterval(checkMarker);\n          var marker = markers.find(function(m) { return m.id === highlightId; });\n          if (marker && map) {\n            map.setView([marker.lat, marker.lng], 16);\n            openSidebar(marker);\n            window.history.replaceState({}, '', window.location.pathname);\n          }\n        }\n      }, 100);\n      setTimeout(function() { clearInterval(checkMarker); }, 5000);\n    }\n  }\n\n  function initMap() {\n    map = L.map('map').setView([44.8860, 37.326], 14);\n    \n    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {\n      attribution: '© OpenStreetMap'\n    }).addTo(map);\n\n    markersLayer = L.layerGroup().addTo(map);\n\n    map.on('click', function(e) {\n      openModal(e.latlng, null);\n    });\n\n    initColorPicker();\n    loadMarkers();\n  }\n\n  // Инициализация\n  init();\n\n  return {\n    selectColor: selectColor,\n    toggleLegend: toggleLegend,\n    closeModal: closeModal,\n    handleFiles: handleFiles,\n    removeFile: removeFile,\n    saveMarker: saveMarker,\n    closeSidebar: closeSidebar,\n    editMarker: editMarker,\n    deleteMarker: deleteMarker,\n    openViewer: openViewer,\n    closeViewer: closeViewer\n  };\n})();\n</script>	html		{}	Интерактивная карта Нажмите на карту, чтобы добавить метку Легенда Добавить метку × Название * Описание Цвет / Категория Медиа файлы Загрузить файлы Отмена Сохранить × ×	file-text	e2928484-6bbc-4f29-8016-ecf0df98d02f	3	f	f	{}			{}	2026-01-02 12:38:35.227+03	2026-01-02 12:38:47.504+03	73e7e5ea-13eb-4509-bed7-441541ed1447	73e7e5ea-13eb-4509-bed7-441541ed1447
f3db2edf-a40a-4699-a006-801c8b9dcbda	stomatologi	Стоматологи	<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n<title>Карточки врачей</title>\n<!-- Quill.js для редактора заметок -->\n<link href="https://cdn.quilljs.com/1.3.7/quill.snow.css" rel="stylesheet">\n<script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>\n<style>\n:root {\n  --dc-primary: #2563eb;\n  --dc-primary-hover: #1d4ed8;\n  --dc-bg: #f8fafc;\n  --dc-card-bg: #ffffff;\n  --dc-border: #e2e8f0;\n  --dc-text: #1e293b;\n  --dc-text-secondary: #64748b;\n  --dc-danger: #dc2626;\n  --dc-success: #16a34a;\n  --dc-shadow: 0 1px 3px rgba(0,0,0,0.1);\n  --dc-shadow-lg: 0 4px 12px rgba(0,0,0,0.15);\n  --dc-radius: 12px;\n  --dc-inactive: #94a3b8;\n}\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--dc-bg); color: var(--dc-text); }\n#doctors-app { max-width: 1200px; margin: 0 auto; padding: 20px; }\n\n.dc-header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 20px; }\n.dc-header h1 { font-size: 24px; font-weight: 700; flex: 1; min-width: 200px; display: flex; align-items: center; gap: 10px; }\n.dc-header h1 svg { width: 28px; height: 28px; color: var(--dc-primary); }\n.dc-search { flex: 1; min-width: 200px; max-width: 400px; }\n.dc-search input, .dc-input { width: 100%; padding: 8px 12px; border: 1px solid var(--dc-border); border-radius: 8px; font-size: 13px; }\n.dc-input:focus { outline: none; border-color: var(--dc-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }\n\n.dc-filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; align-items: center; }\n.dc-select { padding: 8px 12px; border: 1px solid var(--dc-border); border-radius: 8px; font-size: 14px; background: white; min-width: 180px; }\n\n/* Filter buttons */\n.dc-filter-group { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }\n.dc-filter-label { font-size: 12px; color: var(--dc-text-secondary); font-weight: 500; }\n.dc-filter-btn { padding: 6px 12px; border: 1px solid var(--dc-border); border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; background: white; color: var(--dc-text-secondary); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }\n.dc-filter-btn:hover { border-color: var(--dc-primary); color: var(--dc-primary); }\n.dc-filter-btn:active { transform: scale(0.96); }\n.dc-filter-btn.active { background: var(--dc-primary); color: white; border-color: var(--dc-primary); }\n\n.dc-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }\n.dc-btn:active { transform: scale(0.97); }\n.dc-btn svg { width: 16px; height: 16px; }\n.dc-btn-primary { background: var(--dc-primary); color: white; }\n.dc-btn-primary:hover { background: var(--dc-primary-hover); }\n.dc-btn-secondary { background: var(--dc-card-bg); color: var(--dc-text); border: 1px solid var(--dc-border); }\n\n.dc-empty { text-align: center; padding: 60px 20px; color: var(--dc-text-secondary); }\n.dc-empty svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }\n.dc-empty h3 { font-size: 18px; margin-bottom: 8px; color: var(--dc-text); }\n.dc-loading { text-align: center; padding: 12px; color: var(--dc-text-secondary); font-size: 12px; }\n\n.dc-cards { display: flex; flex-direction: column; gap: 16px; }\n.dc-card { background: var(--dc-card-bg); border-radius: var(--dc-radius); border: 1px solid var(--dc-border); overflow: hidden; transition: all 0.3s; }\n.dc-card:hover { box-shadow: var(--dc-shadow-lg); }\n.dc-card.highlighted { border-color: var(--dc-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.2); }\n\n/* Card top section with clinics and tags */\n.dc-card-top { display: flex; gap: 8px; padding: 12px 16px; background: var(--dc-bg); border-bottom: 1px solid var(--dc-border); flex-wrap: wrap; align-items: center; }\n.dc-clinics { display: flex; gap: 6px; flex-wrap: wrap; }\n.dc-clinic { min-width: 60px; padding: 4px 8px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: white; background: var(--dc-inactive); transition: all 0.2s; text-align: center; }\n.dc-clinic.active { opacity: 1; }\n\n/* Tags */\n.dc-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }\n.dc-tag { padding: 4px 10px; background: #e0f2fe; color: #0369a1; border-radius: 12px; font-size: 11px; font-weight: 500; }\n\n.dc-card-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px; gap: 12px; }\n.dc-card-info { flex: 1; min-width: 0; }\n.dc-card-name { font-size: 17px; font-weight: 600; color: var(--dc-text); margin: 0 0 4px 0; }\n.dc-card-name a { color: inherit; text-decoration: none; }\n.dc-card-name a:hover { color: var(--dc-primary); }\n.dc-card-specialty { font-size: 13px; color: var(--dc-primary); font-weight: 500; margin-bottom: 8px; }\n.dc-card-details { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--dc-text-secondary); }\n.dc-card-details > div { display: flex; align-items: center; gap: 4px; }\n.dc-card-details svg { width: 14px; height: 14px; opacity: 0.7; }\n\n.dc-tabs { display: flex; gap: 4px; }\n.dc-tab { padding: 6px 10px; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }\n.dc-tab:active { transform: scale(0.92); }\n.dc-tab svg { width: 18px; height: 18px; }\n.dc-tab:hover { background: var(--dc-bg); }\n.dc-tab.active { background: var(--dc-primary); color: white; }\n.dc-tab.btn-edit:hover { background: #dbeafe; color: var(--dc-primary); }\n.dc-tab.btn-delete:hover { background: #fee2e2; color: var(--dc-danger); }\n\n.dc-card-body { padding: 16px; border-top: 1px solid var(--dc-border); }\n.dc-tab-content { display: none; }\n.dc-tab-content.active { display: block; }\n.dc-notes { font-size: 13px; color: var(--dc-text-secondary); line-height: 1.6; margin-bottom: 12px; }\n.dc-notes p { margin: 0 0 8px 0; }\n.dc-notes ul, .dc-notes ol { margin: 0 0 8px 20px; }\n\n/* Collapsible notes */\n.dc-notes-wrapper { position: relative; }\n.dc-notes-content { max-height: 80px; overflow: hidden; transition: max-height 0.3s ease; }\n.dc-notes-content.expanded { max-height: 2000px; }\n.dc-notes-fade { position: absolute; bottom: 0; left: 0; right: 0; height: 40px; background: linear-gradient(transparent, var(--dc-card-bg)); pointer-events: none; transition: opacity 0.3s; }\n.dc-notes-content.expanded + .dc-notes-fade { opacity: 0; }\n.dc-notes-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 4px 0; font-size: 12px; color: var(--dc-primary); cursor: pointer; border: none; background: none; font-weight: 500; }\n.dc-notes-toggle:hover { text-decoration: underline; }\n.dc-notes-toggle svg { width: 14px; height: 14px; transition: transform 0.3s; }\n.dc-notes-toggle.expanded svg { transform: rotate(180deg); }\n\n/* Timeline */\n.dc-timeline-container { margin-top: 12px; }\n.dc-timeline-labels { display: flex; justify-content: space-between; font-size: 10px; color: var(--dc-text-secondary); margin-bottom: 4px; padding: 0; position: relative; height: 20px; }\n.dc-timeline-labels span { position: absolute; transform: translateX(-50%); }\n.dc-timeline { position: relative; height: 32px; background: #f1f5f9; border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0; }\n.dc-timeline-grid { position: absolute; width: 1px; height: 100%; background: #ddd; z-index: 1; }\n.dc-timeline-period { position: absolute; height: 100%; background: #c8e6c9; border: 2px solid #81c784; z-index: 2; }\n.dc-timeline-busy { position: absolute; height: 100%; background: #ffcdd2; border: 2px solid #e57373; border-radius: 4px; z-index: 10; cursor: pointer; }\n\n.dc-services-container { max-height: 300px; overflow-y: auto; overflow-x: auto; -webkit-overflow-scrolling: touch; }\n.dc-services-table { width: 100%; border-collapse: collapse; font-size: 12px; }\n.dc-services-table th { background: var(--dc-bg); padding: 8px 10px; text-align: left; font-weight: 600; border-bottom: 1px solid var(--dc-border); position: sticky; top: 0; }\n.dc-services-table td { padding: 8px 10px; border-bottom: 1px solid var(--dc-border); color: var(--dc-text-secondary); }\n.dc-services-table tr:hover td { background: #f8fafc; }\n\n/* Modal */\n.dc-modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 16px; opacity: 0; visibility: hidden; transition: all 0.3s; }\n.dc-modal.active { opacity: 1; visibility: visible; }\n.dc-modal-content { background: var(--dc-card-bg); border-radius: var(--dc-radius); width: 100%; max-width: 700px; max-height: calc(100vh - 32px); overflow: hidden; display: flex; flex-direction: column; transform: scale(0.9); transition: transform 0.3s; }\n.dc-modal.active .dc-modal-content { transform: scale(1); }\n.dc-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--dc-border); flex-shrink: 0; }\n.dc-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; }\n.dc-modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--dc-text-secondary); line-height: 1; }\n.dc-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; min-height: 0; -webkit-overflow-scrolling: touch; }\n.dc-modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--dc-border); background: var(--dc-bg); flex-shrink: 0; }\n\n.dc-form-group { margin-bottom: 12px; }\n.dc-form-group label { display: block; font-size: 12px; font-weight: 500; color: var(--dc-text); margin-bottom: 4px; }\n.dc-textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--dc-border); border-radius: 8px; font-size: 13px; resize: vertical; min-height: 60px; font-family: inherit; }\n.dc-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }\n.dc-form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }\n\n/* Search results */\n.dc-search-wrapper { position: relative; }\n.dc-search-results { position: absolute; top: 100%; left: 0; right: 0; background: var(--dc-card-bg); border: 1px solid var(--dc-border); border-radius: 8px; max-height: 250px; overflow-y: auto; z-index: 100; display: none; box-shadow: var(--dc-shadow-lg); }\n.dc-search-results.active { display: block; }\n.dc-search-result { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--dc-border); }\n.dc-search-result:last-child { border-bottom: none; }\n.dc-search-result:hover { background: var(--dc-bg); }\n.dc-search-result-name { font-weight: 500; color: var(--dc-text); font-size: 13px; }\n.dc-search-result-spec { font-size: 11px; color: var(--dc-text-secondary); margin-top: 2px; }\n\n/* Clinics checkboxes */\n.dc-clinics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }\n.dc-clinic-check { display: flex; align-items: center; justify-content: center; padding: 6px 8px; border: 1.5px solid var(--dc-border); border-radius: 6px; cursor: pointer; transition: all 0.2s; font-size: 12px; font-weight: 500; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }\n.dc-clinic-check:hover { border-color: var(--dc-primary); background: #f0f7ff; }\n.dc-clinic-check:active { transform: scale(0.95); }\n.dc-clinic-check.selected { border-color: var(--dc-primary); background: #dbeafe; }\n.dc-clinic-check input { display: none; }\n\n/* Quill editor styles */\n.dc-editor-container { border: 1px solid var(--dc-border); border-radius: 8px; overflow: hidden; }\n.dc-editor-container .ql-toolbar { border: none; border-bottom: 1px solid var(--dc-border); background: var(--dc-bg); padding: 6px; }\n.dc-editor-container .ql-container { border: none; font-size: 13px; min-height: 80px; }\n.dc-editor-container .ql-editor { min-height: 80px; padding: 8px 10px; }\n.dc-editor-container .ql-editor.ql-blank::before { font-style: normal; color: var(--dc-text-secondary); }\n\n.dc-toast { position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; background: #333; color: white; border-radius: 8px; opacity: 0; transform: translateY(20px); transition: all 0.3s; z-index: 10001; }\n.dc-toast.show { opacity: 1; transform: translateY(0); }\n.dc-toast.success { background: var(--dc-success); }\n.dc-toast.error { background: var(--dc-danger); }\n\n@media (max-width: 768px) {\n  #doctors-app { padding: 12px; }\n  \n  .dc-header { flex-direction: column; align-items: stretch; gap: 10px; }\n  .dc-header h1 { font-size: 20px; justify-content: center; }\n  .dc-header h1 svg { width: 24px; height: 24px; }\n  .dc-search { max-width: 100%; }\n  .dc-btn-primary { justify-content: center; }\n  \n  .dc-filters { flex-direction: column; gap: 10px; }\n  .dc-select { width: 100%; }\n  .dc-filter-group { flex-direction: column; align-items: flex-start; gap: 6px; }\n  .dc-filter-group > div { display: flex; flex-wrap: wrap; gap: 6px; }\n  \n  .dc-card-top { padding: 10px 12px; }\n  .dc-clinics { gap: 4px; }\n  .dc-clinic { min-width: 50px; padding: 3px 6px; font-size: 10px; }\n  .dc-tags { margin-left: 0; margin-top: 6px; width: 100%; }\n  .dc-tag { font-size: 10px; padding: 3px 8px; }\n  \n  .dc-card-header { flex-direction: column; padding: 12px; gap: 10px; }\n  .dc-card-info { width: 100%; }\n  .dc-card-name { font-size: 15px; }\n  .dc-card-specialty { font-size: 12px; }\n  .dc-card-details { gap: 8px; font-size: 11px; }\n  .dc-card-details svg { width: 12px; height: 12px; }\n  \n  .dc-tabs { width: 100%; justify-content: space-between; }\n  .dc-tab { flex: 1; justify-content: center; padding: 8px; }\n  .dc-tab svg { width: 20px; height: 20px; }\n  \n  .dc-card-body { padding: 12px; }\n  .dc-notes { font-size: 12px; }\n  .dc-notes-content { max-height: 60px; }\n  \n  .dc-timeline-labels { font-size: 8px; height: 16px; }\n  .dc-timeline { height: 24px; }\n  \n  .dc-services-table { font-size: 11px; }\n  .dc-services-table th, .dc-services-table td { padding: 6px 8px; }\n  \n  /* Modal mobile */\n  .dc-modal { padding: 0; align-items: flex-end; }\n  .dc-modal-content { max-width: 100%; max-height: 90vh; border-radius: 16px 16px 0 0; }\n  .dc-modal-header { padding: 12px 16px; }\n  .dc-modal-header h3 { font-size: 15px; }\n  .dc-modal-body { padding: 12px 16px; }\n  .dc-modal-footer { padding: 10px 16px; }\n  \n  .dc-form-row, .dc-form-row-3 { grid-template-columns: 1fr; }\n  .dc-form-group { margin-bottom: 10px; }\n  .dc-form-group label { font-size: 11px; }\n  .dc-input { padding: 10px 12px; font-size: 16px; } /* 16px prevents iOS zoom */\n  \n  .dc-clinics-grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }\n  .dc-clinic-check { padding: 8px 6px; font-size: 11px; }\n  \n  .dc-search-results { max-height: 200px; }\n  .dc-search-result { padding: 12px; }\n  .dc-search-result-name { font-size: 14px; }\n  \n  .dc-btn { padding: 10px 16px; font-size: 14px; }\n  .dc-btn-secondary { flex: 1; justify-content: center; }\n  .dc-btn-primary { flex: 2; justify-content: center; }\n  \n  .dc-editor-container .ql-editor { min-height: 100px; font-size: 16px; }\n}\n\n@media (max-width: 400px) {\n  .dc-clinics-grid { grid-template-columns: repeat(2, 1fr); }\n  .dc-clinic { min-width: 40px; font-size: 9px; }\n  .dc-tabs { gap: 2px; }\n  .dc-tab { padding: 6px; }\n}\n</style>\n</head>\n<body>\n<div id="doctors-app">\n  <div class="dc-header">\n    <h1>\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>\n        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>\n      </svg>\n      Карточки врачей\n    </h1>\n    <div class="dc-search">\n      <input type="text" id="filter-search" placeholder="Поиск по имени..." oninput="dcApp.debounceFilter()">\n    </div>\n    <button class="dc-btn dc-btn-primary" onclick="dcApp.openAddModal()">\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\n      Добавить врача\n    </button>\n  </div>\n\n  <div class="dc-filters">\n    <select id="filter-specialty" class="dc-select" onchange="dcApp.filterCards()">\n      <option value="">Все специальности</option>\n    </select>\n    <div class="dc-filter-group">\n      <span class="dc-filter-label">Клиника:</span>\n      <div id="filter-clinics"></div>\n    </div>\n    <div class="dc-filter-group" id="filter-tags-container" style="display:none;">\n      <span class="dc-filter-label">Теги:</span>\n      <div id="filter-tags"></div>\n    </div>\n  </div>\n\n  <div id="dc-cards-container" class="dc-cards"><div class="dc-loading">Загрузка...</div></div>\n\n  <div id="dc-modal" class="dc-modal">\n    <div class="dc-modal-content">\n      <div class="dc-modal-header">\n        <h3 id="modal-title">Добавить врача</h3>\n        <button type="button" class="dc-modal-close" onclick="dcApp.closeModal()">&times;</button>\n      </div>\n      <form id="dc-form" onsubmit="dcApp.saveCard(event)">\n        <div class="dc-modal-body">\n          <input type="hidden" id="edit-id">\n          <input type="hidden" id="edit-mis-user-id">\n          \n          <div class="dc-form-row">\n            <div class="dc-form-group">\n              <label>Поиск врача в МИС</label>\n              <div class="dc-search-wrapper">\n                <input type="text" id="mis-search" class="dc-input" placeholder="Поиск по ФИО..." oninput="dcApp.searchMIS(this.value)">\n                <div id="mis-search-results" class="dc-search-results"></div>\n              </div>\n            </div>\n            <div class="dc-form-group">\n              <label>ФИО *</label>\n              <input type="text" id="edit-fullname" required class="dc-input">\n            </div>\n          </div>\n          \n          <div class="dc-form-row-3">\n            <div class="dc-form-group">\n              <label>Специальность</label>\n              <input type="text" id="edit-specialty" class="dc-input">\n            </div>\n            <div class="dc-form-group">\n              <label>Стаж</label>\n              <input type="text" id="edit-experience" class="dc-input">\n            </div>\n            <div class="dc-form-group">\n              <label>Возраст пац.</label>\n              <input type="text" id="edit-age-range" class="dc-input" placeholder="0+">\n            </div>\n          </div>\n          \n          <div class="dc-form-row-3">\n            <div class="dc-form-group">\n              <label>Вн. номер</label>\n              <input type="text" id="edit-internal" class="dc-input">\n            </div>\n            <div class="dc-form-group">\n              <label>Мобильный</label>\n              <input type="text" id="edit-mobile" class="dc-input" placeholder="+7(___) ___-__-__" oninput="dcApp.formatPhone(this)" maxlength="18">\n            </div>\n            <div class="dc-form-group">\n              <label>Ссылка</label>\n              <input type="text" id="edit-profile-url" class="dc-input" placeholder="https://...">\n            </div>\n          </div>\n\n          <div class="dc-form-row">\n            <div class="dc-form-group">\n              <label>Хэштеги (через запятую)</label>\n              <input type="text" id="edit-tags" class="dc-input" placeholder="на дому, УЗИ, КТ">\n            </div>\n            <div class="dc-form-group">\n              <label>Клиники</label>\n              <div id="clinics-checkboxes" class="dc-clinics-grid"></div>\n            </div>\n          </div>\n          \n          <div class="dc-form-group">\n            <label>Заметки</label>\n            <div class="dc-editor-container">\n              <div id="edit-notes-editor"></div>\n            </div>\n          </div>\n        </div>\n        \n        <div class="dc-modal-footer">\n          <button type="button" class="dc-btn dc-btn-secondary" onclick="dcApp.closeModal()">Отмена</button>\n          <button type="submit" class="dc-btn dc-btn-primary">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>\n            Сохранить\n          </button>\n        </div>\n      </form>\n    </div>\n  </div>\n\n  <div id="dc-toast" class="dc-toast"></div>\n</div>\n\n<script>\nwindow.dcApp = (function() {\n  var API_BASE = window.location.protocol + '//' + window.location.hostname + ':9001/api';\n  var PAGE_SLUG = getPageSlug();\n  var cards = [];\n  var filteredCards = [];\n  var allTags = [];\n  var debounceTimer = null;\n  var searchTimer = null;\n  var highlightId = null;\n  var selectedFilterClinic = null;\n  var selectedFilterTag = null;\n  var notesEditor = null;\n\n  var CLINICS = [\n    { id: 1, name: 'Альфа', color: '#FF80AB' },\n    { id: 2, name: 'Кидс', color: '#FFA726' },\n    { id: 3, name: 'Проф', color: '#7E57C2' },\n    { id: 4, name: 'Линия', color: '#C5E1A5' },\n    { id: 5, name: '3К', color: '#BA68C8' },\n    { id: 6, name: 'Смайл', color: '#555555' }\n  ];\n\n  // SVG Icons\n  var ICONS = {\n    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',\n    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',\n    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',\n    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',\n    baby: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>',\n    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',\n    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',\n    mobile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'\n  };\n\n  function getPageSlug() {\n    var match = window.location.pathname.match(/\\/page\\/([^\\/\\?]+)/);\n    return match ? match[1] : 'default';\n  }\n\n  function getToken() { return localStorage.getItem('token'); }\n\n  function fetchAPI(url, options) {\n    options = options || {};\n    return fetch(url, {\n      method: options.method || 'GET',\n      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },\n      body: options.body\n    }).then(function(r) {\n      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Error'); });\n      return r.json();\n    });\n  }\n\n  function showToast(msg, type) {\n    var t = document.getElementById('dc-toast');\n    if (!t) return;\n    t.textContent = msg;\n    t.className = 'dc-toast show ' + (type || '');\n    setTimeout(function() { t.className = 'dc-toast'; }, 3000);\n  }\n\n  function escapeHtml(s) {\n    if (!s) return '';\n    var d = document.createElement('div');\n    d.textContent = s;\n    return d.innerHTML;\n  }\n\n  function formatDateForAPI(date) {\n    var d = date || new Date();\n    return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // PHONE MASK\n  // ═══════════════════════════════════════════════════════════════\n\n  function formatPhone(input) {\n    var value = input.value.replace(/\\D/g, '');\n    if (value.length === 0) {\n      input.value = '';\n      return;\n    }\n    // Remove leading 7 or 8 if present\n    if (value[0] === '7' || value[0] === '8') {\n      value = value.substring(1);\n    }\n    var formatted = '+7(';\n    if (value.length > 0) formatted += value.substring(0, 3);\n    if (value.length >= 3) formatted += ') ';\n    if (value.length > 3) formatted += value.substring(3, 6);\n    if (value.length >= 6) formatted += '-';\n    if (value.length > 6) formatted += value.substring(6, 8);\n    if (value.length >= 8) formatted += '-';\n    if (value.length > 8) formatted += value.substring(8, 10);\n    input.value = formatted;\n  }\n\n  function getCleanPhone(formatted) {\n    return formatted ? formatted.replace(/\\D/g, '') : '';\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // TAGS HELPERS\n  // ═══════════════════════════════════════════════════════════════\n\n  function parseTags(tagsString) {\n    if (!tagsString) return [];\n    return tagsString.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 0; });\n  }\n\n  function collectAllTags() {\n    var tagsSet = {};\n    cards.forEach(function(c) {\n      var cardTags = (c.metadata && c.metadata.tags) || [];\n      cardTags.forEach(function(t) { tagsSet[t] = true; });\n    });\n    allTags = Object.keys(tagsSet).sort();\n  }\n\n  function renderFilterTags() {\n    var container = document.getElementById('filter-tags');\n    var wrapper = document.getElementById('filter-tags-container');\n    if (!container || !wrapper) return;\n\n    if (allTags.length === 0) {\n      wrapper.style.display = 'none';\n      return;\n    }\n    wrapper.style.display = 'flex';\n\n    container.innerHTML = '<button type="button" class="dc-filter-btn' + (!selectedFilterTag ? ' active' : '') + '" data-tag="">Все</button>' +\n      allTags.map(function(tag) {\n        return '<button type="button" class="dc-filter-btn' + (selectedFilterTag === tag ? ' active' : '') + '" data-tag="' + escapeHtml(tag) + '">#' + escapeHtml(tag) + '</button>';\n      }).join('');\n\n    container.querySelectorAll('.dc-filter-btn').forEach(function(btn) {\n      btn.addEventListener('click', function() {\n        var tag = this.dataset.tag;\n        selectedFilterTag = tag || null;\n        container.querySelectorAll('.dc-filter-btn').forEach(function(b) { b.classList.remove('active'); });\n        this.classList.add('active');\n        filterCards();\n      });\n    });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // FILTER CLINICS\n  // ═══════════════════════════════════════════════════════════════\n\n  function renderFilterClinics() {\n    var container = document.getElementById('filter-clinics');\n    if (!container) return;\n    \n    container.innerHTML = '<button type="button" class="dc-filter-btn' + (!selectedFilterClinic ? ' active' : '') + '" data-clinic-id="">Все</button>' +\n      CLINICS.map(function(c) {\n        return '<button type="button" class="dc-filter-btn' + (selectedFilterClinic === c.id ? ' active' : '') + '" data-clinic-id="' + c.id + '">' + c.name + '</button>';\n      }).join('');\n    \n    container.querySelectorAll('.dc-filter-btn').forEach(function(btn) {\n      btn.addEventListener('click', function() {\n        var cid = this.dataset.clinicId;\n        selectedFilterClinic = cid ? parseInt(cid) : null;\n        container.querySelectorAll('.dc-filter-btn').forEach(function(b) { b.classList.remove('active'); });\n        this.classList.add('active');\n        filterCards();\n      });\n    });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // DATA LOADING\n  // ═══════════════════════════════════════════════════════════════\n\n  function loadCards() {\n    fetchAPI(API_BASE + '/doctor-cards/page/' + PAGE_SLUG + '?sortBy=sortOrder&sortOrder=ASC')\n      .then(function(data) {\n        cards = data;\n        filteredCards = cards.slice();\n        collectAllTags();\n        renderCards();\n        loadSpecialties();\n        renderFilterClinics();\n        renderFilterTags();\n      })\n      .catch(function(e) { showToast('Ошибка загрузки: ' + e.message, 'error'); });\n  }\n\n  function loadSpecialties() {\n    fetchAPI(API_BASE + '/doctor-cards/page/' + PAGE_SLUG + '/specialties')\n      .then(function(list) {\n        var sel = document.getElementById('filter-specialty');\n        if (!sel) return;\n        sel.innerHTML = '<option value="">Все специальности</option>' + list.map(function(s) {\n          return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';\n        }).join('');\n      }).catch(function() {});\n  }\n\n  function debounceFilter() {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(filterCards, 300);\n  }\n\n  function filterCards() {\n    var searchEl = document.getElementById('filter-search');\n    var specEl = document.getElementById('filter-specialty');\n    var search = searchEl ? searchEl.value.toLowerCase() : '';\n    var specialty = specEl ? specEl.value : '';\n\n    filteredCards = cards.filter(function(c) {\n      if (search && !c.fullName.toLowerCase().includes(search)) return false;\n      if (specialty && c.specialty !== specialty) return false;\n      if (selectedFilterClinic) {\n        var cardClinics = (c.metadata && c.metadata.clinics) || [];\n        if (cardClinics.indexOf(selectedFilterClinic) === -1) return false;\n      }\n      if (selectedFilterTag) {\n        var cardTags = (c.metadata && c.metadata.tags) || [];\n        if (cardTags.indexOf(selectedFilterTag) === -1) return false;\n      }\n      return true;\n    });\n    renderCards();\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // RENDERING\n  // ═══════════════════════════════════════════════════════════════\n\n  function renderCards() {\n    var container = document.getElementById('dc-cards-container');\n    if (!container) return;\n    \n    if (!filteredCards.length) {\n      container.innerHTML = '<div class="dc-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg><h3>Список врачей пуст</h3><p>Нажмите "Добавить врача"</p></div>';\n      return;\n    }\n\n    container.innerHTML = filteredCards.map(function(card) {\n      var meta = card.metadata || {};\n      var cardClinics = meta.clinics || [];\n      var cardTags = meta.tags || [];\n      var isHighlighted = highlightId && card.id === highlightId;\n\n      var clinicBadges = CLINICS.map(function(c) {\n        var isActive = cardClinics.indexOf(c.id) !== -1;\n        var style = isActive ? 'background:' + c.color : '';\n        return '<div class="dc-clinic' + (isActive ? ' active' : '') + '" style="' + style + '">' + c.name + '</div>';\n      }).join('');\n\n      var tagBadges = cardTags.length > 0 ? '<div class="dc-tags">' + cardTags.map(function(t) {\n        return '<span class="dc-tag">#' + escapeHtml(t) + '</span>';\n      }).join('') + '</div>' : '';\n\n      var nameHtml = card.profileUrl \n        ? '<a href="' + escapeHtml(card.profileUrl) + '">' + escapeHtml(card.fullName) + '</a>'\n        : escapeHtml(card.fullName);\n\n      return '<div class="dc-card' + (isHighlighted ? ' highlighted' : '') + '" data-id="' + card.id + '">' +\n        '<div class="dc-card-top">' +\n          '<div class="dc-clinics">' + clinicBadges + '</div>' +\n          tagBadges +\n        '</div>' +\n        '<div class="dc-card-header">' +\n          '<div class="dc-card-info">' +\n            '<h3 class="dc-card-name">' + nameHtml + '</h3>' +\n            (card.specialty ? '<div class="dc-card-specialty">' + escapeHtml(card.specialty) + '</div>' : '') +\n            '<div class="dc-card-details">' +\n              (meta.ageRange ? '<div>' + ICONS.baby + ' ' + escapeHtml(meta.ageRange) + '</div>' : '') +\n              (card.experience ? '<div>' + ICONS.calendar + ' ' + escapeHtml(card.experience) + '</div>' : '') +\n              (meta.internalNumber ? '<div>' + ICONS.phone + ' вн. ' + escapeHtml(meta.internalNumber) + '</div>' : '') +\n              (meta.mobileNumber ? '<div>' + ICONS.mobile + ' ' + escapeHtml(meta.mobileNumber) + '</div>' : '') +\n            '</div>' +\n          '</div>' +\n          '<div class="dc-tabs">' +\n            '<button type="button" class="dc-tab active" data-card="' + card.id + '" data-tab="info" onclick="dcApp.switchTab(this)">' + ICONS.info + '</button>' +\n            '<button type="button" class="dc-tab" data-card="' + card.id + '" data-tab="services" onclick="dcApp.switchTab(this)">' + ICONS.chart + '</button>' +\n            '<button type="button" class="dc-tab btn-edit" onclick="dcApp.openEditModal(\\'' + card.id + '\\')">' + ICONS.edit + '</button>' +\n            '<button type="button" class="dc-tab btn-delete" onclick="dcApp.deleteCard(\\'' + card.id + '\\')">' + ICONS.trash + '</button>' +\n          '</div>' +\n        '</div>' +\n        '<div class="dc-card-body" id="body-' + card.id + '">' +\n          '<div class="dc-tab-content active" data-tab="info">' +\n            (card.description ? \n              '<div class="dc-notes-wrapper">' +\n                '<div class="dc-notes-content" id="notes-content-' + card.id + '">' +\n                  '<div class="dc-notes">' + card.description + '</div>' +\n                '</div>' +\n                '<div class="dc-notes-fade" id="notes-fade-' + card.id + '"></div>' +\n                '<button type="button" class="dc-notes-toggle" id="notes-toggle-' + card.id + '" onclick="dcApp.toggleNotes(\\'' + card.id + '\\')" style="display:none;">' +\n                  '<span>Показать больше</span>' +\n                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +\n                '</button>' +\n              '</div>' \n            : '<div class="dc-notes" style="color:#999">Заметки отсутствуют</div>') +\n            '<div class="dc-timeline-container">' +\n              '<div class="dc-timeline-labels" id="labels-' + card.id + '"></div>' +\n              '<div class="dc-timeline" id="timeline-' + card.id + '"></div>' +\n            '</div>' +\n          '</div>' +\n          '<div class="dc-tab-content" data-tab="services">' +\n            '<div class="dc-services-container">' +\n              '<table class="dc-services-table"><thead><tr><th>Артикул</th><th>Услуга</th><th>Длит.</th><th>Цена</th></tr></thead>' +\n              '<tbody id="services-' + card.id + '"><tr><td colspan="4" style="text-align:center;color:#999">Нажмите на вкладку для загрузки</td></tr></tbody></table>' +\n            '</div>' +\n          '</div>' +\n        '</div>' +\n      '</div>';\n    }).join('');\n\n    loadScheduleForAllCards();\n    checkNotesOverflow();\n\n    if (highlightId) {\n      setTimeout(function() {\n        var el = document.querySelector('[data-id="' + highlightId + '"]');\n        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });\n      }, 100);\n    }\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // NOTES EXPAND/COLLAPSE\n  // ═══════════════════════════════════════════════════════════════\n\n  function checkNotesOverflow() {\n    filteredCards.forEach(function(card) {\n      var content = document.getElementById('notes-content-' + card.id);\n      var toggle = document.getElementById('notes-toggle-' + card.id);\n      var fade = document.getElementById('notes-fade-' + card.id);\n      if (!content || !toggle) return;\n      \n      // Check if content overflows\n      var maxHeight = parseInt(window.getComputedStyle(content).maxHeight);\n      if (content.scrollHeight > maxHeight + 10) {\n        toggle.style.display = 'inline-flex';\n        if (fade) fade.style.display = 'block';\n      } else {\n        toggle.style.display = 'none';\n        if (fade) fade.style.display = 'none';\n      }\n    });\n  }\n\n  function toggleNotes(cardId) {\n    var content = document.getElementById('notes-content-' + cardId);\n    var toggle = document.getElementById('notes-toggle-' + cardId);\n    if (!content || !toggle) return;\n    \n    var isExpanded = content.classList.toggle('expanded');\n    toggle.classList.toggle('expanded', isExpanded);\n    toggle.querySelector('span').textContent = isExpanded ? 'Скрыть' : 'Показать больше';\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // TABS\n  // ═══════════════════════════════════════════════════════════════\n\n  function switchTab(btn) {\n    var cardId = btn.dataset.card;\n    var tabName = btn.dataset.tab;\n    var card = document.querySelector('[data-id="' + cardId + '"]');\n    if (!card) return;\n\n    card.querySelectorAll('.dc-tab[data-tab]').forEach(function(t) { t.classList.remove('active'); });\n    btn.classList.add('active');\n\n    var body = document.getElementById('body-' + cardId);\n    if (!body) return;\n    body.querySelectorAll('.dc-tab-content').forEach(function(c) { c.classList.remove('active'); });\n    var content = body.querySelector('[data-tab="' + tabName + '"]');\n    if (content) content.classList.add('active');\n\n    if (tabName === 'services') {\n      var cardData = cards.find(function(c) { return c.id === cardId; });\n      if (cardData && cardData.metadata && cardData.metadata.misUserId) {\n        loadServices(cardId, cardData.metadata.misUserId);\n      } else {\n        var tbody = document.getElementById('services-' + cardId);\n        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Врач не привязан к МИС</td></tr>';\n      }\n    }\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // SCHEDULE\n  // ═══════════════════════════════════════════════════════════════\n\n  function loadScheduleForAllCards() {\n    var userIds = filteredCards\n      .filter(function(c) { return c.metadata && c.metadata.misUserId; })\n      .map(function(c) { return c.metadata.misUserId; });\n    \n    if (userIds.length === 0) {\n      filteredCards.forEach(function(card) { renderEmptyTimeline(card.id); });\n      return;\n    }\n    \n    var now = new Date();\n    var timeStart = formatDateForAPI(now) + ' 00:00';\n    var timeEnd = formatDateForAPI(now) + ' 23:59';\n    \n    Promise.all([\n      fetchAPI(API_BASE + '/mis/schedule-periods', {\n        method: 'POST',\n        body: JSON.stringify({ user_id: userIds.join(','), time_start: timeStart, time_end: timeEnd })\n      }),\n      fetchAPI(API_BASE + '/mis/schedule', {\n        method: 'POST',\n        body: JSON.stringify({ user_id: userIds.join(','), time_start: timeStart, time_end: timeEnd, show_busy: true, show_past: false, step: 30 })\n      })\n    ]).then(function(results) {\n      var periodsData = results[0];\n      var slotsData = results[1];\n      \n      filteredCards.forEach(function(card) {\n        var misUserId = card.metadata && card.metadata.misUserId;\n        if (!misUserId) { renderEmptyTimeline(card.id); return; }\n        \n        var periods = [];\n        if (periodsData.error === 0 && periodsData.data) {\n          periods = Array.isArray(periodsData.data) ? periodsData.data.filter(function(p) { return String(p.user_id) === String(misUserId); }) : [];\n        }\n        \n        var busySlots = [];\n        if (slotsData.error === 0 && slotsData.data) {\n          var allSlots = Array.isArray(slotsData.data) ? slotsData.data : [];\n          busySlots = allSlots.filter(function(s) { return String(s.user_id) === String(misUserId) && s.is_busy; });\n        }\n        \n        renderTimeline(card.id, periods, busySlots);\n      });\n    }).catch(function(e) {\n      console.log('Schedule error:', e);\n      filteredCards.forEach(function(card) { renderEmptyTimeline(card.id); });\n    });\n  }\n\n  function renderTimeline(cardId, periods, busySlots) {\n    var timeline = document.getElementById('timeline-' + cardId);\n    var labelsContainer = document.getElementById('labels-' + cardId);\n    if (!timeline || !labelsContainer) return;\n    \n    var startHour = 8, endHour = 21, hoursCount = endHour - startHour, totalMinutes = hoursCount * 60;\n    timeline.innerHTML = '';\n    labelsContainer.innerHTML = '';\n    labelsContainer.style.position = 'relative';\n    labelsContainer.style.height = '20px';\n    \n    for (var h = startHour; h <= endHour; h++) {\n      var label = document.createElement('span');\n      label.textContent = h + ':00';\n      label.style.left = ((h - startHour) / hoursCount) * 100 + '%';\n      labelsContainer.appendChild(label);\n      \n      if (h < endHour) {\n        var grid = document.createElement('div');\n        grid.className = 'dc-timeline-grid';\n        grid.style.left = ((h - startHour) / hoursCount) * 100 + '%';\n        timeline.appendChild(grid);\n      }\n    }\n    \n    if (periods && periods.length > 0) {\n      periods.forEach(function(p) {\n        var startTime = p.time_start_short || (p.time_start ? p.time_start.split(' ')[1] : null);\n        var endTime = p.time_end_short || (p.time_end ? p.time_end.split(' ')[1] : null);\n        if (!startTime || !endTime) return;\n        \n        var st = startTime.split(':').map(Number);\n        var et = endTime.split(':').map(Number);\n        var startMin = st[0] * 60 + st[1];\n        var endMin = et[0] * 60 + et[1];\n        \n        if (endMin <= startHour * 60 || startMin >= endHour * 60) return;\n        var startOffset = Math.max(0, startMin - startHour * 60);\n        var endOffset = Math.min(totalMinutes, endMin - startHour * 60);\n        var duration = endOffset - startOffset;\n        if (duration <= 0) return;\n        \n        var pb = document.createElement('div');\n        pb.className = 'dc-timeline-period';\n        pb.style.left = (startOffset / totalMinutes) * 100 + '%';\n        pb.style.width = (duration / totalMinutes) * 100 + '%';\n        pb.title = 'Рабочее время: ' + startTime + ' — ' + endTime;\n        timeline.appendChild(pb);\n      });\n    }\n    \n    if (busySlots && busySlots.length > 0) {\n      busySlots.forEach(function(s) {\n        var startTime = s.time_start_short || (s.time_start ? s.time_start.split(' ')[1] : null);\n        var endTime = s.time_end_short || (s.time_end ? s.time_end.split(' ')[1] : null);\n        if (!startTime || !endTime) return;\n        \n        var st = startTime.split(':').map(Number);\n        var et = endTime.split(':').map(Number);\n        var startMin = st[0] * 60 + st[1];\n        var endMin = et[0] * 60 + et[1];\n        \n        if (endMin <= startHour * 60 || startMin >= endHour * 60) return;\n        var startOffset = Math.max(0, startMin - startHour * 60);\n        var endOffset = Math.min(totalMinutes, endMin - startHour * 60);\n        var duration = endOffset - startOffset;\n        if (duration <= 0) return;\n        \n        var bb = document.createElement('div');\n        bb.className = 'dc-timeline-busy';\n        bb.style.left = (startOffset / totalMinutes) * 100 + '%';\n        bb.style.width = (duration / totalMinutes) * 100 + '%';\n        bb.title = 'ЗАНЯТО: ' + startTime + ' — ' + endTime;\n        timeline.appendChild(bb);\n      });\n    }\n  }\n\n  function renderEmptyTimeline(cardId) {\n    var timeline = document.getElementById('timeline-' + cardId);\n    var labelsContainer = document.getElementById('labels-' + cardId);\n    if (!timeline || !labelsContainer) return;\n    \n    var startHour = 8, endHour = 21, hoursCount = endHour - startHour;\n    timeline.innerHTML = '';\n    labelsContainer.innerHTML = '';\n    labelsContainer.style.position = 'relative';\n    labelsContainer.style.height = '20px';\n    \n    for (var h = startHour; h <= endHour; h++) {\n      var label = document.createElement('span');\n      label.textContent = h + ':00';\n      label.style.left = ((h - startHour) / hoursCount) * 100 + '%';\n      labelsContainer.appendChild(label);\n    }\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // SERVICES\n  // ═══════════════════════════════════════════════════════════════\n\n  function loadServices(cardId, misUserId) {\n    var tbody = document.getElementById('services-' + cardId);\n    if (!tbody) return;\n    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Загрузка...</td></tr>';\n\n    fetchAPI(API_BASE + '/mis/doctor-info', {\n      method: 'POST',\n      body: JSON.stringify({ userId: misUserId })\n    }).then(function(data) {\n      if (data.success && data.data && data.data.services && data.data.services.length > 0) {\n        return fetchAPI(API_BASE + '/mis/services', {\n          method: 'POST',\n          body: JSON.stringify({ service_ids: data.data.services })\n        });\n      }\n      throw new Error('Нет услуг');\n    }).then(function(servData) {\n      if (servData.error === 0 && servData.data) {\n        var services = Array.isArray(servData.data) ? servData.data : [servData.data];\n        if (services.length === 0) {\n          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Услуги не найдены</td></tr>';\n          return;\n        }\n        tbody.innerHTML = services.map(function(s) {\n          return '<tr><td>' + (s.code || '—') + '</td><td>' + escapeHtml(s.title || '—') + '</td><td>' + (s.duration ? s.duration + ' мин' : '—') + '</td><td>' + (s.price ? Number(s.price).toLocaleString('ru-RU') + ' ₽' : '—') + '</td></tr>';\n        }).join('');\n      } else {\n        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Услуги не найдены</td></tr>';\n      }\n    }).catch(function(e) {\n      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Нет данных об услугах</td></tr>';\n    });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // MIS SEARCH\n  // ═══════════════════════════════════════════════════════════════\n\n  function searchMIS(query) {\n    var resultsDiv = document.getElementById('mis-search-results');\n    if (!resultsDiv) return;\n    \n    if (query.length < 2) {\n      resultsDiv.classList.remove('active');\n      return;\n    }\n\n    clearTimeout(searchTimer);\n    searchTimer = setTimeout(function() {\n      resultsDiv.innerHTML = '<div class="dc-loading">Поиск...</div>';\n      resultsDiv.classList.add('active');\n\n      fetchAPI(API_BASE + '/mis/doctors', { method: 'POST', body: JSON.stringify({}) })\n        .then(function(data) {\n          if (data.error === 0 && data.data) {\n            var doctors = Array.isArray(data.data) ? data.data : [];\n            var filtered = doctors.filter(function(d) {\n              var name = (d.name || (d.last_name + ' ' + d.first_name + ' ' + (d.middle_name || ''))).toLowerCase();\n              return name.includes(query.toLowerCase());\n            }).slice(0, 10);\n\n            if (filtered.length === 0) {\n              resultsDiv.innerHTML = '<div class="dc-loading">Ничего не найдено</div>';\n            } else {\n              resultsDiv.innerHTML = filtered.map(function(d) {\n                var name = d.name || (d.last_name + ' ' + d.first_name + ' ' + (d.middle_name || '')).trim();\n                var specs = d.professions ? d.professions.map(function(p) { return p.title || p; }).join(', ') : (d.profession_titles || '');\n                var dataStr = encodeURIComponent(JSON.stringify(d));\n                return '<div class="dc-search-result" onclick="dcApp.selectDoctor(decodeURIComponent(\\'' + dataStr + '\\'))">' +\n                  '<div class="dc-search-result-name">' + escapeHtml(name) + '</div>' +\n                  (specs ? '<div class="dc-search-result-spec">' + escapeHtml(specs) + '</div>' : '') +\n                '</div>';\n              }).join('');\n            }\n          } else {\n            resultsDiv.innerHTML = '<div class="dc-loading">Ошибка загрузки</div>';\n          }\n        })\n        .catch(function() {\n          resultsDiv.innerHTML = '<div class="dc-loading">Ошибка поиска</div>';\n        });\n    }, 400);\n  }\n\n  function selectDoctor(dataStr) {\n    var doctor = JSON.parse(dataStr);\n    var resultsDiv = document.getElementById('mis-search-results');\n    if (resultsDiv) resultsDiv.classList.remove('active');\n    \n    var searchInput = document.getElementById('mis-search');\n    if (searchInput) searchInput.value = '';\n\n    var name = doctor.name || (doctor.last_name + ' ' + doctor.first_name + ' ' + (doctor.middle_name || '')).trim();\n    var specs = doctor.professions ? doctor.professions.map(function(p) { return p.title || p; }).join(', ') : (doctor.profession_titles || '');\n    var clinicIds = doctor.clinics ? doctor.clinics.map(function(c) { return typeof c === 'object' ? c.id : c; }) : [];\n\n    setValue('edit-fullname', name);\n    setValue('edit-specialty', specs);\n    setValue('edit-mis-user-id', doctor.id);\n    setValue('edit-experience', doctor.work_period || '');\n    setValue('edit-internal', doctor.internal_number || '');\n\n    updateClinicCheckboxes(clinicIds);\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // QUILL EDITOR\n  // ═══════════════════════════════════════════════════════════════\n\n  function initEditor() {\n    if (notesEditor) return;\n    notesEditor = new Quill('#edit-notes-editor', {\n      theme: 'snow',\n      placeholder: 'Введите заметки...',\n      modules: {\n        toolbar: [\n          ['bold', 'italic', 'underline'],\n          [{ 'list': 'ordered'}, { 'list': 'bullet' }],\n          ['link'],\n          ['clean']\n        ]\n      }\n    });\n  }\n\n  function setEditorContent(html) {\n    if (!notesEditor) initEditor();\n    notesEditor.root.innerHTML = html || '';\n  }\n\n  function getEditorContent() {\n    if (!notesEditor) return '';\n    var html = notesEditor.root.innerHTML;\n    return html === '<p><br></p>' ? '' : html;\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // MODAL\n  // ═══════════════════════════════════════════════════════════════\n\n  function renderClinicsCheckboxes(selectedClinics) {\n    var container = document.getElementById('clinics-checkboxes');\n    if (!container) return;\n    \n    selectedClinics = selectedClinics || [];\n    \n    container.innerHTML = CLINICS.map(function(c) {\n      var isSelected = selectedClinics.indexOf(c.id) !== -1;\n      return '<div class="dc-clinic-check' + (isSelected ? ' selected' : '') + '" data-clinic-id="' + c.id + '">' +\n        '<input type="checkbox" value="' + c.id + '"' + (isSelected ? ' checked' : '') + '>' +\n        c.name +\n      '</div>';\n    }).join('');\n    \n    container.querySelectorAll('.dc-clinic-check').forEach(function(el) {\n      el.addEventListener('click', function(e) {\n        e.preventDefault();\n        e.stopPropagation();\n        var checkbox = this.querySelector('input');\n        checkbox.checked = !checkbox.checked;\n        this.classList.toggle('selected', checkbox.checked);\n      });\n    });\n  }\n\n  function updateClinicCheckboxes(selectedClinics) {\n    var container = document.getElementById('clinics-checkboxes');\n    if (!container) return;\n    \n    container.querySelectorAll('.dc-clinic-check').forEach(function(el) {\n      var cid = parseInt(el.dataset.clinicId);\n      var isSelected = selectedClinics.indexOf(cid) !== -1;\n      var checkbox = el.querySelector('input');\n      if (checkbox) checkbox.checked = isSelected;\n      el.classList.toggle('selected', isSelected);\n    });\n  }\n\n  function getSelectedClinics() {\n    var clinics = [];\n    document.querySelectorAll('#clinics-checkboxes input:checked').forEach(function(cb) {\n      clinics.push(parseInt(cb.value));\n    });\n    return clinics;\n  }\n\n  function setValue(id, value) {\n    var el = document.getElementById(id);\n    if (el) el.value = value || '';\n  }\n\n  function getValue(id) {\n    var el = document.getElementById(id);\n    return el ? el.value.trim() : '';\n  }\n\n  function openAddModal() {\n    document.getElementById('modal-title').textContent = 'Добавить врача';\n    document.getElementById('dc-form').reset();\n    setValue('edit-id', '');\n    setValue('edit-mis-user-id', '');\n    setValue('edit-tags', '');\n    renderClinicsCheckboxes([]);\n    initEditor();\n    setEditorContent('');\n    document.getElementById('dc-modal').classList.add('active');\n  }\n\n  function openEditModal(id) {\n    var card = cards.find(function(c) { return c.id === id; });\n    if (!card) return;\n    var meta = card.metadata || {};\n    \n    document.getElementById('modal-title').textContent = 'Редактировать врача';\n    setValue('edit-id', card.id);\n    setValue('edit-mis-user-id', meta.misUserId || '');\n    setValue('edit-fullname', card.fullName || '');\n    setValue('edit-specialty', card.specialty || '');\n    setValue('edit-experience', card.experience || '');\n    setValue('edit-age-range', meta.ageRange || '');\n    setValue('edit-profile-url', card.profileUrl || '');\n    setValue('edit-internal', meta.internalNumber || '');\n    setValue('edit-tags', (meta.tags || []).join(', '));\n    \n    // Format phone for display\n    var mobileEl = document.getElementById('edit-mobile');\n    if (mobileEl && meta.mobileNumber) {\n      mobileEl.value = meta.mobileNumber;\n    } else if (mobileEl) {\n      mobileEl.value = '';\n    }\n    \n    renderClinicsCheckboxes(meta.clinics || []);\n    initEditor();\n    setEditorContent(card.description || '');\n    document.getElementById('dc-modal').classList.add('active');\n  }\n\n  function closeModal() {\n    document.getElementById('dc-modal').classList.remove('active');\n  }\n\n  function saveCard(e) {\n    e.preventDefault();\n    var id = getValue('edit-id');\n    var tagsInput = getValue('edit-tags');\n    var tags = parseTags(tagsInput);\n    \n    var data = {\n      pageSlug: PAGE_SLUG,\n      fullName: getValue('edit-fullname'),\n      specialty: getValue('edit-specialty'),\n      experience: getValue('edit-experience'),\n      profileUrl: getValue('edit-profile-url'),\n      description: getEditorContent(),\n      misUserId: getValue('edit-mis-user-id') || null,\n      ageRange: getValue('edit-age-range'),\n      internalNumber: getValue('edit-internal'),\n      mobileNumber: getValue('edit-mobile'),\n      clinics: getSelectedClinics(),\n      tags: tags\n    };\n\n    var url = id ? API_BASE + '/doctor-cards/' + id : API_BASE + '/doctor-cards';\n    fetchAPI(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })\n      .then(function() {\n        showToast(id ? 'Карточка обновлена' : 'Врач добавлен', 'success');\n        closeModal();\n        loadCards();\n      })\n      .catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function deleteCard(id) {\n    if (!confirm('Удалить карточку врача?')) return;\n    fetchAPI(API_BASE + '/doctor-cards/' + id, { method: 'DELETE' })\n      .then(function() {\n        showToast('Карточка удалена', 'success');\n        loadCards();\n      })\n      .catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // INIT\n  // ═══════════════════════════════════════════════════════════════\n\n  function init() {\n    var params = new URLSearchParams(window.location.search);\n    highlightId = params.get('highlight');\n    loadCards();\n  }\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', init);\n  } else {\n    init();\n  }\n\n  return {\n    loadCards: loadCards,\n    filterCards: filterCards,\n    debounceFilter: debounceFilter,\n    switchTab: switchTab,\n    toggleNotes: toggleNotes,\n    openAddModal: openAddModal,\n    openEditModal: openEditModal,\n    closeModal: closeModal,\n    saveCard: saveCard,\n    deleteCard: deleteCard,\n    searchMIS: searchMIS,\n    selectDoctor: selectDoctor,\n    formatPhone: formatPhone\n  };\n})();\n</script>\n</body>\n</html>	html		{}	Карточки врачей Карточки врачей Добавить врача Клиника: Теги: Загрузка... Добавить врача × Поиск врача в МИС ФИО * Специальность Стаж Возраст пац. Вн. номер Мобильный Ссылка Хэштеги (через запятую) Клиники Заметки Отмена Сохранить	file-text	e2928484-6bbc-4f29-8016-ecf0df98d02f	4	f	f	{}			{}	2026-01-02 15:52:12.764+03	2026-01-03 19:30:33.919+03	73e7e5ea-13eb-4509-bed7-441541ed1447	73e7e5ea-13eb-4509-bed7-441541ed1447
f847df2d-eda6-44bd-aea7-b7ce031dd632	ginekologi	Гинекологи	<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Карточки врачей</title>\n<style>\n:root {\n  --dc-primary: #2563eb;\n  --dc-primary-hover: #1d4ed8;\n  --dc-bg: #f8fafc;\n  --dc-card-bg: #ffffff;\n  --dc-border: #e2e8f0;\n  --dc-text: #1e293b;\n  --dc-text-secondary: #64748b;\n  --dc-danger: #dc2626;\n  --dc-success: #16a34a;\n  --dc-shadow: 0 1px 3px rgba(0,0,0,0.1);\n  --dc-shadow-lg: 0 4px 12px rgba(0,0,0,0.15);\n  --dc-radius: 12px;\n  --dc-inactive: #94a3b8;\n}\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--dc-bg); color: var(--dc-text); }\n#doctors-app { max-width: 1200px; margin: 0 auto; padding: 20px; }\n\n.dc-header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 20px; }\n.dc-header h1 { font-size: 24px; font-weight: 700; flex: 1; min-width: 200px; display: flex; align-items: center; gap: 10px; }\n.dc-header h1 svg { width: 28px; height: 28px; color: var(--dc-primary); }\n.dc-search { flex: 1; min-width: 200px; max-width: 400px; }\n.dc-search input, .dc-input { width: 100%; padding: 10px 14px; border: 1px solid var(--dc-border); border-radius: 8px; font-size: 14px; }\n.dc-input:focus { outline: none; border-color: var(--dc-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }\n\n.dc-filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; align-items: center; }\n.dc-select { padding: 8px 12px; border: 1px solid var(--dc-border); border-radius: 8px; font-size: 14px; background: white; min-width: 180px; }\n\n/* Filter clinic buttons */\n.dc-filter-clinics { display: flex; gap: 6px; flex-wrap: wrap; }\n.dc-filter-clinic { padding: 6px 12px; border: 1px solid var(--dc-border); border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; background: white; color: var(--dc-text-secondary); }\n.dc-filter-clinic:hover { border-color: var(--dc-primary); color: var(--dc-primary); }\n.dc-filter-clinic.active { background: var(--dc-primary); color: white; border-color: var(--dc-primary); }\n\n.dc-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }\n.dc-btn svg { width: 16px; height: 16px; }\n.dc-btn-primary { background: var(--dc-primary); color: white; }\n.dc-btn-primary:hover { background: var(--dc-primary-hover); }\n.dc-btn-secondary { background: var(--dc-card-bg); color: var(--dc-text); border: 1px solid var(--dc-border); }\n\n.dc-empty { text-align: center; padding: 60px 20px; color: var(--dc-text-secondary); }\n.dc-empty svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }\n.dc-empty h3 { font-size: 18px; margin-bottom: 8px; color: var(--dc-text); }\n.dc-loading { text-align: center; padding: 12px; color: var(--dc-text-secondary); font-size: 12px; }\n\n.dc-cards { display: flex; flex-direction: column; gap: 16px; }\n.dc-card { background: var(--dc-card-bg); border-radius: var(--dc-radius); border: 1px solid var(--dc-border); overflow: hidden; transition: all 0.3s; }\n.dc-card:hover { box-shadow: var(--dc-shadow-lg); }\n.dc-card.highlighted { border-color: var(--dc-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.2); }\n\n.dc-clinics { display: flex; gap: 6px; padding: 12px 16px; background: var(--dc-bg); border-bottom: 1px solid var(--dc-border); flex-wrap: wrap; }\n.dc-clinic { min-width: 70px; padding: 5px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: white; background: var(--dc-inactive); transition: all 0.2s; text-align: center; }\n.dc-clinic.active { opacity: 1; }\n\n.dc-card-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px; gap: 12px; }\n.dc-card-info { flex: 1; min-width: 0; }\n.dc-card-name { font-size: 17px; font-weight: 600; color: var(--dc-text); margin: 0 0 4px 0; }\n.dc-card-name a { color: inherit; text-decoration: none; }\n.dc-card-name a:hover { color: var(--dc-primary); }\n.dc-card-specialty { font-size: 13px; color: var(--dc-primary); font-weight: 500; margin-bottom: 8px; }\n.dc-card-details { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--dc-text-secondary); }\n.dc-card-details > div { display: flex; align-items: center; gap: 4px; }\n.dc-card-details svg { width: 14px; height: 14px; opacity: 0.7; }\n\n.dc-tabs { display: flex; gap: 4px; }\n.dc-tab { padding: 6px 10px; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }\n.dc-tab svg { width: 18px; height: 18px; }\n.dc-tab:hover { background: var(--dc-bg); }\n.dc-tab.active { background: var(--dc-primary); color: white; }\n.dc-tab.btn-edit:hover { background: #dbeafe; color: var(--dc-primary); }\n.dc-tab.btn-delete:hover { background: #fee2e2; color: var(--dc-danger); }\n\n.dc-card-body { padding: 16px; border-top: 1px solid var(--dc-border); }\n.dc-tab-content { display: none; }\n.dc-tab-content.active { display: block; }\n.dc-notes { font-size: 13px; color: var(--dc-text-secondary); line-height: 1.6; margin-bottom: 16px; }\n\n/* Timeline */\n.dc-timeline-container { margin-top: 12px; }\n.dc-timeline-labels { display: flex; justify-content: space-between; font-size: 10px; color: var(--dc-text-secondary); margin-bottom: 4px; padding: 0; position: relative; height: 20px; }\n.dc-timeline-labels span { position: absolute; transform: translateX(-50%); }\n.dc-timeline { position: relative; height: 32px; background: #f1f5f9; border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0; }\n.dc-timeline-grid { position: absolute; width: 1px; height: 100%; background: #ddd; z-index: 1; }\n.dc-timeline-period { position: absolute; height: 100%; background: #c8e6c9; border: 2px solid #81c784; z-index: 2; }\n.dc-timeline-busy { position: absolute; height: 100%; background: #ffcdd2; border: 2px solid #e57373; border-radius: 4px; z-index: 10; cursor: pointer; }\n\n.dc-services-container { max-height: 300px; overflow-y: auto; }\n.dc-services-table { width: 100%; border-collapse: collapse; font-size: 12px; }\n.dc-services-table th { background: var(--dc-bg); padding: 8px 10px; text-align: left; font-weight: 600; border-bottom: 1px solid var(--dc-border); position: sticky; top: 0; }\n.dc-services-table td { padding: 8px 10px; border-bottom: 1px solid var(--dc-border); color: var(--dc-text-secondary); }\n.dc-services-table tr:hover td { background: #f8fafc; }\n\n/* Modal */\n.dc-modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px; opacity: 0; visibility: hidden; transition: all 0.3s; }\n.dc-modal.active { opacity: 1; visibility: visible; }\n.dc-modal-content { background: var(--dc-card-bg); border-radius: var(--dc-radius); width: 100%; max-width: 600px; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; transform: scale(0.9); transition: transform 0.3s; }\n.dc-modal.active .dc-modal-content { transform: scale(1); }\n.dc-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--dc-border); }\n.dc-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; }\n.dc-modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--dc-text-secondary); }\n.dc-modal-body { padding: 20px; overflow-y: auto; flex: 1; }\n.dc-modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--dc-border); background: var(--dc-bg); }\n\n.dc-form-group { margin-bottom: 16px; }\n.dc-form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--dc-text); margin-bottom: 5px; }\n.dc-textarea { width: 100%; padding: 9px 12px; border: 1px solid var(--dc-border); border-radius: 8px; font-size: 13px; resize: vertical; min-height: 70px; font-family: inherit; }\n.dc-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }\n\n/* Search results */\n.dc-search-wrapper { position: relative; }\n.dc-search-results { position: absolute; top: 100%; left: 0; right: 0; background: var(--dc-card-bg); border: 1px solid var(--dc-border); border-radius: 8px; max-height: 250px; overflow-y: auto; z-index: 100; display: none; box-shadow: var(--dc-shadow-lg); }\n.dc-search-results.active { display: block; }\n.dc-search-result { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--dc-border); }\n.dc-search-result:last-child { border-bottom: none; }\n.dc-search-result:hover { background: var(--dc-bg); }\n.dc-search-result-name { font-weight: 500; color: var(--dc-text); font-size: 13px; }\n.dc-search-result-spec { font-size: 11px; color: var(--dc-text-secondary); margin-top: 2px; }\n\n/* Clinics checkboxes - UPDATED: equal width, full stretch */\n.dc-clinics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }\n.dc-clinic-check { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 12px; border: 2px solid var(--dc-border); border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 13px; font-weight: 500; }\n.dc-clinic-check:hover { border-color: var(--dc-primary); background: #f0f7ff; }\n.dc-clinic-check.selected { border-color: var(--dc-primary); background: #dbeafe; }\n.dc-clinic-check input { display: none; }\n\n.dc-toast { position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; background: #333; color: white; border-radius: 8px; opacity: 0; transform: translateY(20px); transition: all 0.3s; z-index: 10001; }\n.dc-toast.show { opacity: 1; transform: translateY(0); }\n.dc-toast.success { background: var(--dc-success); }\n.dc-toast.error { background: var(--dc-danger); }\n\n@media (max-width: 768px) {\n  .dc-form-row { grid-template-columns: 1fr; }\n  .dc-header { flex-direction: column; align-items: stretch; }\n  .dc-clinics-grid { grid-template-columns: repeat(2, 1fr); }\n}\n</style>\n</head>\n<body>\n<div id="doctors-app">\n  <div class="dc-header">\n    <h1>\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>\n        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>\n      </svg>\n      Карточки врачей\n    </h1>\n    <div class="dc-search">\n      <input type="text" id="filter-search" placeholder="Поиск по имени..." oninput="dcApp.debounceFilter()">\n    </div>\n    <button class="dc-btn dc-btn-primary" onclick="dcApp.openAddModal()">\n      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\n      Добавить врача\n    </button>\n  </div>\n\n  <div class="dc-filters">\n    <select id="filter-specialty" class="dc-select" onchange="dcApp.filterCards()">\n      <option value="">Все специальности</option>\n    </select>\n    <div class="dc-filter-clinics" id="filter-clinics"></div>\n  </div>\n\n  <div id="dc-cards-container" class="dc-cards"><div class="dc-loading">Загрузка...</div></div>\n\n  <div id="dc-modal" class="dc-modal">\n    <div class="dc-modal-content">\n      <div class="dc-modal-header">\n        <h3 id="modal-title">Добавить врача</h3>\n        <button type="button" class="dc-modal-close" onclick="dcApp.closeModal()">&times;</button>\n      </div>\n      <form id="dc-form" onsubmit="dcApp.saveCard(event)">\n        <div class="dc-modal-body">\n          <input type="hidden" id="edit-id">\n          <input type="hidden" id="edit-mis-user-id">\n          \n          <div class="dc-form-group">\n            <label>Поиск врача в МИС</label>\n            <div class="dc-search-wrapper">\n              <input type="text" id="mis-search" class="dc-input" placeholder="Начните вводить ФИО..." oninput="dcApp.searchMIS(this.value)">\n              <div id="mis-search-results" class="dc-search-results"></div>\n            </div>\n          </div>\n          \n          <div class="dc-form-group">\n            <label>ФИО *</label>\n            <input type="text" id="edit-fullname" required class="dc-input">\n          </div>\n          \n          <div class="dc-form-row">\n            <div class="dc-form-group">\n              <label>Специальность</label>\n              <input type="text" id="edit-specialty" class="dc-input">\n            </div>\n            <div class="dc-form-group">\n              <label>Стаж</label>\n              <input type="text" id="edit-experience" class="dc-input">\n            </div>\n          </div>\n          \n          <div class="dc-form-row">\n            <div class="dc-form-group">\n              <label>Возраст пациентов</label>\n              <input type="text" id="edit-age-range" class="dc-input" placeholder="0+">\n            </div>\n            <div class="dc-form-group">\n              <label>Ссылка на страницу</label>\n              <input type="text" id="edit-profile-url" class="dc-input">\n            </div>\n          </div>\n\n          <div class="dc-form-row">\n            <div class="dc-form-group">\n              <label>Внутренний номер</label>\n              <input type="text" id="edit-internal" class="dc-input">\n            </div>\n            <div class="dc-form-group">\n              <label>Мобильный</label>\n              <input type="text" id="edit-mobile" class="dc-input">\n            </div>\n          </div>\n          \n          <div class="dc-form-group">\n            <label>Клиники</label>\n            <div id="clinics-checkboxes" class="dc-clinics-grid"></div>\n          </div>\n          \n          <div class="dc-form-group">\n            <label>Заметки</label>\n            <textarea id="edit-notes" class="dc-textarea" rows="3"></textarea>\n          </div>\n        </div>\n        \n        <div class="dc-modal-footer">\n          <button type="button" class="dc-btn dc-btn-secondary" onclick="dcApp.closeModal()">Отмена</button>\n          <button type="submit" class="dc-btn dc-btn-primary">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>\n            Сохранить\n          </button>\n        </div>\n      </form>\n    </div>\n  </div>\n\n  <div id="dc-toast" class="dc-toast"></div>\n</div>\n\n<script>\nwindow.dcApp = (function() {\n  var API_BASE = window.location.protocol + '//' + window.location.hostname + ':9001/api';\n  var PAGE_SLUG = getPageSlug();\n  var cards = [];\n  var filteredCards = [];\n  var debounceTimer = null;\n  var searchTimer = null;\n  var highlightId = null;\n  var selectedFilterClinic = null;\n\n  var CLINICS = [\n    { id: 1, name: 'Альфа', color: '#FF80AB' },\n    { id: 2, name: 'Кидс', color: '#FFA726' },\n    { id: 3, name: 'Проф', color: '#7E57C2' },\n    { id: 4, name: 'Линия', color: '#C5E1A5' },\n    { id: 5, name: '3К', color: '#BA68C8' },\n    { id: 6, name: 'Смайл', color: '#555555' }\n  ];\n\n  // SVG Icons\n  var ICONS = {\n    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',\n    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',\n    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',\n    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',\n    baby: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>',\n    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',\n    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',\n    mobile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'\n  };\n\n  function getPageSlug() {\n    var match = window.location.pathname.match(/\\/page\\/([^\\/\\?]+)/);\n    return match ? match[1] : 'default';\n  }\n\n  function getToken() { return localStorage.getItem('token'); }\n\n  function fetchAPI(url, options) {\n    options = options || {};\n    return fetch(url, {\n      method: options.method || 'GET',\n      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },\n      body: options.body\n    }).then(function(r) {\n      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Error'); });\n      return r.json();\n    });\n  }\n\n  function showToast(msg, type) {\n    var t = document.getElementById('dc-toast');\n    if (!t) return;\n    t.textContent = msg;\n    t.className = 'dc-toast show ' + (type || '');\n    setTimeout(function() { t.className = 'dc-toast'; }, 3000);\n  }\n\n  function escapeHtml(s) {\n    if (!s) return '';\n    var d = document.createElement('div');\n    d.textContent = s;\n    return d.innerHTML;\n  }\n\n  function formatDateForAPI(date) {\n    var d = date || new Date();\n    return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // FILTER CLINICS\n  // ═══════════════════════════════════════════════════════════════\n\n  function renderFilterClinics() {\n    var container = document.getElementById('filter-clinics');\n    if (!container) return;\n    \n    container.innerHTML = '<button type="button" class="dc-filter-clinic' + (!selectedFilterClinic ? ' active' : '') + '" data-clinic-id="">Все</button>' +\n      CLINICS.map(function(c) {\n        return '<button type="button" class="dc-filter-clinic' + (selectedFilterClinic === c.id ? ' active' : '') + '" data-clinic-id="' + c.id + '">' + c.name + '</button>';\n      }).join('');\n    \n    container.querySelectorAll('.dc-filter-clinic').forEach(function(btn) {\n      btn.addEventListener('click', function() {\n        var cid = this.dataset.clinicId;\n        selectedFilterClinic = cid ? parseInt(cid) : null;\n        container.querySelectorAll('.dc-filter-clinic').forEach(function(b) { b.classList.remove('active'); });\n        this.classList.add('active');\n        filterCards();\n      });\n    });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // DATA LOADING\n  // ═══════════════════════════════════════════════════════════════\n\n  function loadCards() {\n    fetchAPI(API_BASE + '/doctor-cards/page/' + PAGE_SLUG + '?sortBy=sortOrder&sortOrder=ASC')\n      .then(function(data) {\n        cards = data;\n        filteredCards = cards.slice();\n        renderCards();\n        loadSpecialties();\n        renderFilterClinics();\n      })\n      .catch(function(e) { showToast('Ошибка загрузки: ' + e.message, 'error'); });\n  }\n\n  function loadSpecialties() {\n    fetchAPI(API_BASE + '/doctor-cards/page/' + PAGE_SLUG + '/specialties')\n      .then(function(list) {\n        var sel = document.getElementById('filter-specialty');\n        if (!sel) return;\n        sel.innerHTML = '<option value="">Все специальности</option>' + list.map(function(s) {\n          return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';\n        }).join('');\n      }).catch(function() {});\n  }\n\n  function debounceFilter() {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(filterCards, 300);\n  }\n\n  function filterCards() {\n    var searchEl = document.getElementById('filter-search');\n    var specEl = document.getElementById('filter-specialty');\n    var search = searchEl ? searchEl.value.toLowerCase() : '';\n    var specialty = specEl ? specEl.value : '';\n\n    filteredCards = cards.filter(function(c) {\n      if (search && !c.fullName.toLowerCase().includes(search)) return false;\n      if (specialty && c.specialty !== specialty) return false;\n      if (selectedFilterClinic) {\n        var cardClinics = (c.metadata && c.metadata.clinics) || [];\n        if (cardClinics.indexOf(selectedFilterClinic) === -1) return false;\n      }\n      return true;\n    });\n    renderCards();\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // RENDERING\n  // ═══════════════════════════════════════════════════════════════\n\n  function renderCards() {\n    var container = document.getElementById('dc-cards-container');\n    if (!container) return;\n    \n    if (!filteredCards.length) {\n      container.innerHTML = '<div class="dc-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg><h3>Список врачей пуст</h3><p>Нажмите "Добавить врача"</p></div>';\n      return;\n    }\n\n    container.innerHTML = filteredCards.map(function(card) {\n      var meta = card.metadata || {};\n      var cardClinics = meta.clinics || [];\n      var isHighlighted = highlightId && card.id === highlightId;\n\n      var clinicBadges = CLINICS.map(function(c) {\n        var isActive = cardClinics.indexOf(c.id) !== -1;\n        var style = isActive ? 'background:' + c.color : '';\n        return '<div class="dc-clinic' + (isActive ? ' active' : '') + '" style="' + style + '">' + c.name + '</div>';\n      }).join('');\n\n      var nameHtml = card.profileUrl \n        ? '<a href="' + escapeHtml(card.profileUrl) + '">' + escapeHtml(card.fullName) + '</a>'\n        : escapeHtml(card.fullName);\n\n      return '<div class="dc-card' + (isHighlighted ? ' highlighted' : '') + '" data-id="' + card.id + '">' +\n        '<div class="dc-clinics">' + clinicBadges + '</div>' +\n        '<div class="dc-card-header">' +\n          '<div class="dc-card-info">' +\n            '<h3 class="dc-card-name">' + nameHtml + '</h3>' +\n            (card.specialty ? '<div class="dc-card-specialty">' + escapeHtml(card.specialty) + '</div>' : '') +\n            '<div class="dc-card-details">' +\n              (meta.ageRange ? '<div>' + ICONS.baby + ' ' + escapeHtml(meta.ageRange) + '</div>' : '') +\n              (card.experience ? '<div>' + ICONS.calendar + ' ' + escapeHtml(card.experience) + '</div>' : '') +\n              (meta.internalNumber ? '<div>' + ICONS.phone + ' вн. ' + escapeHtml(meta.internalNumber) + '</div>' : '') +\n              (meta.mobileNumber ? '<div>' + ICONS.mobile + ' ' + escapeHtml(meta.mobileNumber) + '</div>' : '') +\n            '</div>' +\n          '</div>' +\n          '<div class="dc-tabs">' +\n            '<button type="button" class="dc-tab active" data-card="' + card.id + '" data-tab="info" onclick="dcApp.switchTab(this)">' + ICONS.info + '</button>' +\n            '<button type="button" class="dc-tab" data-card="' + card.id + '" data-tab="services" onclick="dcApp.switchTab(this)">' + ICONS.chart + '</button>' +\n            '<button type="button" class="dc-tab btn-edit" onclick="dcApp.openEditModal(\\'' + card.id + '\\')">' + ICONS.edit + '</button>' +\n            '<button type="button" class="dc-tab btn-delete" onclick="dcApp.deleteCard(\\'' + card.id + '\\')">' + ICONS.trash + '</button>' +\n          '</div>' +\n        '</div>' +\n        '<div class="dc-card-body" id="body-' + card.id + '">' +\n          '<div class="dc-tab-content active" data-tab="info">' +\n            (card.description ? '<div class="dc-notes">' + escapeHtml(card.description).replace(/\\n/g, '<br>') + '</div>' : '<div class="dc-notes" style="color:#999">Заметки отсутствуют</div>') +\n            '<div class="dc-timeline-container">' +\n              '<div class="dc-timeline-labels" id="labels-' + card.id + '"></div>' +\n              '<div class="dc-timeline" id="timeline-' + card.id + '"></div>' +\n            '</div>' +\n          '</div>' +\n          '<div class="dc-tab-content" data-tab="services">' +\n            '<div class="dc-services-container">' +\n              '<table class="dc-services-table"><thead><tr><th>Артикул</th><th>Услуга</th><th>Длит.</th><th>Цена</th></tr></thead>' +\n              '<tbody id="services-' + card.id + '"><tr><td colspan="4" style="text-align:center;color:#999">Нажмите на вкладку для загрузки</td></tr></tbody></table>' +\n            '</div>' +\n          '</div>' +\n        '</div>' +\n      '</div>';\n    }).join('');\n\n    loadScheduleForAllCards();\n\n    if (highlightId) {\n      setTimeout(function() {\n        var el = document.querySelector('[data-id="' + highlightId + '"]');\n        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });\n      }, 100);\n    }\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // TABS\n  // ═══════════════════════════════════════════════════════════════\n\n  function switchTab(btn) {\n    var cardId = btn.dataset.card;\n    var tabName = btn.dataset.tab;\n    var card = document.querySelector('[data-id="' + cardId + '"]');\n    if (!card) return;\n\n    card.querySelectorAll('.dc-tab[data-tab]').forEach(function(t) { t.classList.remove('active'); });\n    btn.classList.add('active');\n\n    var body = document.getElementById('body-' + cardId);\n    if (!body) return;\n    body.querySelectorAll('.dc-tab-content').forEach(function(c) { c.classList.remove('active'); });\n    var content = body.querySelector('[data-tab="' + tabName + '"]');\n    if (content) content.classList.add('active');\n\n    if (tabName === 'services') {\n      var cardData = cards.find(function(c) { return c.id === cardId; });\n      if (cardData && cardData.metadata && cardData.metadata.misUserId) {\n        loadServices(cardId, cardData.metadata.misUserId);\n      } else {\n        var tbody = document.getElementById('services-' + cardId);\n        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Врач не привязан к МИС</td></tr>';\n      }\n    }\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // SCHEDULE\n  // ═══════════════════════════════════════════════════════════════\n\n  function loadScheduleForAllCards() {\n    var userIds = filteredCards\n      .filter(function(c) { return c.metadata && c.metadata.misUserId; })\n      .map(function(c) { return c.metadata.misUserId; });\n    \n    if (userIds.length === 0) {\n      filteredCards.forEach(function(card) { renderEmptyTimeline(card.id); });\n      return;\n    }\n    \n    var now = new Date();\n    var timeStart = formatDateForAPI(now) + ' 00:00';\n    var timeEnd = formatDateForAPI(now) + ' 23:59';\n    \n    Promise.all([\n      fetchAPI(API_BASE + '/mis/schedule-periods', {\n        method: 'POST',\n        body: JSON.stringify({ user_id: userIds.join(','), time_start: timeStart, time_end: timeEnd })\n      }),\n      fetchAPI(API_BASE + '/mis/schedule', {\n        method: 'POST',\n        body: JSON.stringify({ user_id: userIds.join(','), time_start: timeStart, time_end: timeEnd, show_busy: true, show_past: false, step: 30 })\n      })\n    ]).then(function(results) {\n      var periodsData = results[0];\n      var slotsData = results[1];\n      \n      filteredCards.forEach(function(card) {\n        var misUserId = card.metadata && card.metadata.misUserId;\n        if (!misUserId) { renderEmptyTimeline(card.id); return; }\n        \n        var periods = [];\n        if (periodsData.error === 0 && periodsData.data) {\n          periods = Array.isArray(periodsData.data) ? periodsData.data.filter(function(p) { return String(p.user_id) === String(misUserId); }) : [];\n        }\n        \n        var busySlots = [];\n        if (slotsData.error === 0 && slotsData.data) {\n          var allSlots = Array.isArray(slotsData.data) ? slotsData.data : [];\n          busySlots = allSlots.filter(function(s) { return String(s.user_id) === String(misUserId) && s.is_busy; });\n        }\n        \n        renderTimeline(card.id, periods, busySlots);\n      });\n    }).catch(function(e) {\n      console.log('Schedule error:', e);\n      filteredCards.forEach(function(card) { renderEmptyTimeline(card.id); });\n    });\n  }\n\n  function renderTimeline(cardId, periods, busySlots) {\n    var timeline = document.getElementById('timeline-' + cardId);\n    var labelsContainer = document.getElementById('labels-' + cardId);\n    if (!timeline || !labelsContainer) return;\n    \n    var startHour = 8, endHour = 21, hoursCount = endHour - startHour, totalMinutes = hoursCount * 60;\n    timeline.innerHTML = '';\n    labelsContainer.innerHTML = '';\n    labelsContainer.style.position = 'relative';\n    labelsContainer.style.height = '20px';\n    \n    for (var h = startHour; h <= endHour; h++) {\n      var label = document.createElement('span');\n      label.textContent = h + ':00';\n      label.style.left = ((h - startHour) / hoursCount) * 100 + '%';\n      labelsContainer.appendChild(label);\n      \n      if (h < endHour) {\n        var grid = document.createElement('div');\n        grid.className = 'dc-timeline-grid';\n        grid.style.left = ((h - startHour) / hoursCount) * 100 + '%';\n        timeline.appendChild(grid);\n      }\n    }\n    \n    if (periods && periods.length > 0) {\n      periods.forEach(function(p) {\n        var startTime = p.time_start_short || (p.time_start ? p.time_start.split(' ')[1] : null);\n        var endTime = p.time_end_short || (p.time_end ? p.time_end.split(' ')[1] : null);\n        if (!startTime || !endTime) return;\n        \n        var st = startTime.split(':').map(Number);\n        var et = endTime.split(':').map(Number);\n        var startMin = st[0] * 60 + st[1];\n        var endMin = et[0] * 60 + et[1];\n        \n        if (endMin <= startHour * 60 || startMin >= endHour * 60) return;\n        var startOffset = Math.max(0, startMin - startHour * 60);\n        var endOffset = Math.min(totalMinutes, endMin - startHour * 60);\n        var duration = endOffset - startOffset;\n        if (duration <= 0) return;\n        \n        var pb = document.createElement('div');\n        pb.className = 'dc-timeline-period';\n        pb.style.left = (startOffset / totalMinutes) * 100 + '%';\n        pb.style.width = (duration / totalMinutes) * 100 + '%';\n        pb.title = 'Рабочее время: ' + startTime + ' — ' + endTime;\n        timeline.appendChild(pb);\n      });\n    }\n    \n    if (busySlots && busySlots.length > 0) {\n      busySlots.forEach(function(s) {\n        var startTime = s.time_start_short || (s.time_start ? s.time_start.split(' ')[1] : null);\n        var endTime = s.time_end_short || (s.time_end ? s.time_end.split(' ')[1] : null);\n        if (!startTime || !endTime) return;\n        \n        var st = startTime.split(':').map(Number);\n        var et = endTime.split(':').map(Number);\n        var startMin = st[0] * 60 + st[1];\n        var endMin = et[0] * 60 + et[1];\n        \n        if (endMin <= startHour * 60 || startMin >= endHour * 60) return;\n        var startOffset = Math.max(0, startMin - startHour * 60);\n        var endOffset = Math.min(totalMinutes, endMin - startHour * 60);\n        var duration = endOffset - startOffset;\n        if (duration <= 0) return;\n        \n        var bb = document.createElement('div');\n        bb.className = 'dc-timeline-busy';\n        bb.style.left = (startOffset / totalMinutes) * 100 + '%';\n        bb.style.width = (duration / totalMinutes) * 100 + '%';\n        bb.title = 'ЗАНЯТО: ' + startTime + ' — ' + endTime;\n        timeline.appendChild(bb);\n      });\n    }\n  }\n\n  function renderEmptyTimeline(cardId) {\n    var timeline = document.getElementById('timeline-' + cardId);\n    var labelsContainer = document.getElementById('labels-' + cardId);\n    if (!timeline || !labelsContainer) return;\n    \n    var startHour = 8, endHour = 21, hoursCount = endHour - startHour;\n    timeline.innerHTML = '';\n    labelsContainer.innerHTML = '';\n    labelsContainer.style.position = 'relative';\n    labelsContainer.style.height = '20px';\n    \n    for (var h = startHour; h <= endHour; h++) {\n      var label = document.createElement('span');\n      label.textContent = h + ':00';\n      label.style.left = ((h - startHour) / hoursCount) * 100 + '%';\n      labelsContainer.appendChild(label);\n    }\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // SERVICES\n  // ═══════════════════════════════════════════════════════════════\n\n  function loadServices(cardId, misUserId) {\n    var tbody = document.getElementById('services-' + cardId);\n    if (!tbody) return;\n    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Загрузка...</td></tr>';\n\n    fetchAPI(API_BASE + '/mis/doctor-info', {\n      method: 'POST',\n      body: JSON.stringify({ userId: misUserId })\n    }).then(function(data) {\n      console.log('Doctor info:', data);\n      if (data.success && data.data && data.data.services && data.data.services.length > 0) {\n        return fetchAPI(API_BASE + '/mis/services', {\n          method: 'POST',\n          body: JSON.stringify({ service_ids: data.data.services })\n        });\n      }\n      throw new Error('Нет услуг');\n    }).then(function(servData) {\n      console.log('Services:', servData);\n      if (servData.error === 0 && servData.data) {\n        var services = Array.isArray(servData.data) ? servData.data : [servData.data];\n        if (services.length === 0) {\n          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Услуги не найдены</td></tr>';\n          return;\n        }\n        tbody.innerHTML = services.map(function(s) {\n          return '<tr><td>' + (s.code || '—') + '</td><td>' + escapeHtml(s.title || '—') + '</td><td>' + (s.duration ? s.duration + ' мин' : '—') + '</td><td>' + (s.price ? Number(s.price).toLocaleString('ru-RU') + ' ₽' : '—') + '</td></tr>';\n        }).join('');\n      } else {\n        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Услуги не найдены</td></tr>';\n      }\n    }).catch(function(e) {\n      console.log('Services error:', e);\n      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999">Нет данных об услугах</td></tr>';\n    });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // MIS SEARCH\n  // ═══════════════════════════════════════════════════════════════\n\n  function searchMIS(query) {\n    var resultsDiv = document.getElementById('mis-search-results');\n    if (!resultsDiv) return;\n    \n    if (query.length < 2) {\n      resultsDiv.classList.remove('active');\n      return;\n    }\n\n    clearTimeout(searchTimer);\n    searchTimer = setTimeout(function() {\n      resultsDiv.innerHTML = '<div class="dc-loading">Поиск...</div>';\n      resultsDiv.classList.add('active');\n\n      fetchAPI(API_BASE + '/mis/doctors', { method: 'POST', body: JSON.stringify({}) })\n        .then(function(data) {\n          if (data.error === 0 && data.data) {\n            var doctors = Array.isArray(data.data) ? data.data : [];\n            var filtered = doctors.filter(function(d) {\n              var name = (d.name || (d.last_name + ' ' + d.first_name + ' ' + (d.middle_name || ''))).toLowerCase();\n              return name.includes(query.toLowerCase());\n            }).slice(0, 10);\n\n            if (filtered.length === 0) {\n              resultsDiv.innerHTML = '<div class="dc-loading">Ничего не найдено</div>';\n            } else {\n              resultsDiv.innerHTML = filtered.map(function(d) {\n                var name = d.name || (d.last_name + ' ' + d.first_name + ' ' + (d.middle_name || '')).trim();\n                var specs = d.professions ? d.professions.map(function(p) { return p.title || p; }).join(', ') : (d.profession_titles || '');\n                var dataStr = encodeURIComponent(JSON.stringify(d));\n                return '<div class="dc-search-result" onclick="dcApp.selectDoctor(decodeURIComponent(\\'' + dataStr + '\\'))">' +\n                  '<div class="dc-search-result-name">' + escapeHtml(name) + '</div>' +\n                  (specs ? '<div class="dc-search-result-spec">' + escapeHtml(specs) + '</div>' : '') +\n                '</div>';\n              }).join('');\n            }\n          } else {\n            resultsDiv.innerHTML = '<div class="dc-loading">Ошибка загрузки</div>';\n          }\n        })\n        .catch(function() {\n          resultsDiv.innerHTML = '<div class="dc-loading">Ошибка поиска</div>';\n        });\n    }, 400);\n  }\n\n  function selectDoctor(dataStr) {\n    var doctor = JSON.parse(dataStr);\n    var resultsDiv = document.getElementById('mis-search-results');\n    if (resultsDiv) resultsDiv.classList.remove('active');\n    \n    var searchInput = document.getElementById('mis-search');\n    if (searchInput) searchInput.value = '';\n\n    var name = doctor.name || (doctor.last_name + ' ' + doctor.first_name + ' ' + (doctor.middle_name || '')).trim();\n    var specs = doctor.professions ? doctor.professions.map(function(p) { return p.title || p; }).join(', ') : (doctor.profession_titles || '');\n    var clinicIds = doctor.clinics ? doctor.clinics.map(function(c) { return typeof c === 'object' ? c.id : c; }) : [];\n\n    setValue('edit-fullname', name);\n    setValue('edit-specialty', specs);\n    setValue('edit-mis-user-id', doctor.id);\n    setValue('edit-experience', doctor.work_period || '');\n    setValue('edit-internal', doctor.internal_number || '');\n\n    updateClinicCheckboxes(clinicIds);\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // MODAL\n  // ═══════════════════════════════════════════════════════════════\n\n  function renderClinicsCheckboxes(selectedClinics) {\n    var container = document.getElementById('clinics-checkboxes');\n    if (!container) return;\n    \n    selectedClinics = selectedClinics || [];\n    \n    container.innerHTML = CLINICS.map(function(c) {\n      var isSelected = selectedClinics.indexOf(c.id) !== -1;\n      return '<div class="dc-clinic-check' + (isSelected ? ' selected' : '') + '" data-clinic-id="' + c.id + '">' +\n        '<input type="checkbox" value="' + c.id + '"' + (isSelected ? ' checked' : '') + '>' +\n        c.name +\n      '</div>';\n    }).join('');\n    \n    container.querySelectorAll('.dc-clinic-check').forEach(function(el) {\n      el.addEventListener('click', function(e) {\n        e.preventDefault();\n        e.stopPropagation();\n        var checkbox = this.querySelector('input');\n        checkbox.checked = !checkbox.checked;\n        this.classList.toggle('selected', checkbox.checked);\n      });\n    });\n  }\n\n  function updateClinicCheckboxes(selectedClinics) {\n    var container = document.getElementById('clinics-checkboxes');\n    if (!container) return;\n    \n    container.querySelectorAll('.dc-clinic-check').forEach(function(el) {\n      var cid = parseInt(el.dataset.clinicId);\n      var isSelected = selectedClinics.indexOf(cid) !== -1;\n      var checkbox = el.querySelector('input');\n      if (checkbox) checkbox.checked = isSelected;\n      el.classList.toggle('selected', isSelected);\n    });\n  }\n\n  function getSelectedClinics() {\n    var clinics = [];\n    document.querySelectorAll('#clinics-checkboxes input:checked').forEach(function(cb) {\n      clinics.push(parseInt(cb.value));\n    });\n    return clinics;\n  }\n\n  function setValue(id, value) {\n    var el = document.getElementById(id);\n    if (el) el.value = value || '';\n  }\n\n  function getValue(id) {\n    var el = document.getElementById(id);\n    return el ? el.value.trim() : '';\n  }\n\n  function openAddModal() {\n    document.getElementById('modal-title').textContent = 'Добавить врача';\n    document.getElementById('dc-form').reset();\n    setValue('edit-id', '');\n    setValue('edit-mis-user-id', '');\n    renderClinicsCheckboxes([]);\n    document.getElementById('dc-modal').classList.add('active');\n  }\n\n  function openEditModal(id) {\n    var card = cards.find(function(c) { return c.id === id; });\n    if (!card) return;\n    var meta = card.metadata || {};\n    \n    document.getElementById('modal-title').textContent = 'Редактировать врача';\n    setValue('edit-id', card.id);\n    setValue('edit-mis-user-id', meta.misUserId || '');\n    setValue('edit-fullname', card.fullName || '');\n    setValue('edit-specialty', card.specialty || '');\n    setValue('edit-experience', card.experience || '');\n    setValue('edit-age-range', meta.ageRange || '');\n    setValue('edit-profile-url', card.profileUrl || '');\n    setValue('edit-internal', meta.internalNumber || '');\n    setValue('edit-mobile', meta.mobileNumber || '');\n    setValue('edit-notes', card.description || '');\n    renderClinicsCheckboxes(meta.clinics || []);\n    document.getElementById('dc-modal').classList.add('active');\n  }\n\n  function closeModal() {\n    document.getElementById('dc-modal').classList.remove('active');\n  }\n\n  function saveCard(e) {\n    e.preventDefault();\n    var id = getValue('edit-id');\n    var data = {\n      pageSlug: PAGE_SLUG,\n      fullName: getValue('edit-fullname'),\n      specialty: getValue('edit-specialty'),\n      experience: getValue('edit-experience'),\n      profileUrl: getValue('edit-profile-url'),\n      description: getValue('edit-notes'),\n      misUserId: getValue('edit-mis-user-id') || null,\n      ageRange: getValue('edit-age-range'),\n      internalNumber: getValue('edit-internal'),\n      mobileNumber: getValue('edit-mobile'),\n      clinics: getSelectedClinics()\n    };\n\n    var url = id ? API_BASE + '/doctor-cards/' + id : API_BASE + '/doctor-cards';\n    fetchAPI(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })\n      .then(function() {\n        showToast(id ? 'Карточка обновлена' : 'Врач добавлен', 'success');\n        closeModal();\n        loadCards();\n      })\n      .catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  function deleteCard(id) {\n    if (!confirm('Удалить карточку врача?')) return;\n    fetchAPI(API_BASE + '/doctor-cards/' + id, { method: 'DELETE' })\n      .then(function() {\n        showToast('Карточка удалена', 'success');\n        loadCards();\n      })\n      .catch(function(e) { showToast('Ошибка: ' + e.message, 'error'); });\n  }\n\n  // ═══════════════════════════════════════════════════════════════\n  // INIT\n  // ═══════════════════════════════════════════════════════════════\n\n  function init() {\n    var params = new URLSearchParams(window.location.search);\n    highlightId = params.get('highlight');\n    loadCards();\n  }\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', init);\n  } else {\n    init();\n  }\n\n  return {\n    loadCards: loadCards,\n    filterCards: filterCards,\n    debounceFilter: debounceFilter,\n    switchTab: switchTab,\n    openAddModal: openAddModal,\n    openEditModal: openEditModal,\n    closeModal: closeModal,\n    saveCard: saveCard,\n    deleteCard: deleteCard,\n    searchMIS: searchMIS,\n    selectDoctor: selectDoctor\n  };\n})();\n</script>\n</body>\n</html>	html		{}	Карточки врачей Карточки врачей Добавить врача Загрузка... Добавить врача × Поиск врача в МИС ФИО * Специальность Стаж Возраст пациентов Ссылка на страницу Внутренний номер Мобильный Клиники Заметки Отмена Сохранить	file-text	e2928484-6bbc-4f29-8016-ecf0df98d02f	5	f	f	{}			{}	2026-01-03 09:32:17.51+03	2026-01-03 15:24:02.855+03	73e7e5ea-13eb-4509-bed7-441541ed1447	73e7e5ea-13eb-4509-bed7-441541ed1447
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, name, description, permissions, "isSystem", "createdAt", "updatedAt") FROM stdin;
383e506b-08ad-43e6-ba36-405298347163	Администратор	Полный доступ ко всем функциям системы	{"media": {"read": true, "delete": true, "upload": true}, "pages": {"read": true, "admin": true, "write": true, "delete": true}, "users": {"read": true, "write": true, "delete": true}, "settings": {"read": true, "write": true}}	t	2025-12-31 16:44:17.894+03	2025-12-31 16:44:17.894+03
74dee61e-700d-4999-b12a-0e7ad2c62d81	Редактор	Создание и редактирование страниц	{"media": {"read": true, "delete": false, "upload": true}, "pages": {"read": true, "admin": false, "write": true, "delete": false}, "users": {"read": false, "write": false, "delete": false}, "settings": {"read": false, "write": false}}	f	2025-12-31 16:44:17.904+03	2025-12-31 16:44:17.904+03
e32c4a52-7d28-4f35-8580-0b4bc702d9dc	Читатель	Только просмотр страниц	{"media": {"read": true, "delete": false, "upload": false}, "pages": {"read": true, "admin": false, "write": false, "delete": false}, "users": {"read": false, "write": false, "delete": false}, "settings": {"read": false, "write": false}}	f	2025-12-31 16:44:17.907+03	2025-12-31 16:44:17.907+03
\.


--
-- Data for Name: search_index; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.search_index (id, "entityType", "entityId", title, content, keywords, url, metadata, "createdAt", "updatedAt") FROM stdin;
9befeb6b-46b6-4bd8-85ea-84177293581b	page	af343927-d7d7-4d4a-b492-920e7349aa8c	Аккредитации тест	Telegram-бот напоминаний Подпишитесь на бота, чтобы получать уведомления об истечении сроков аккредитаций за 90, 60, 30, 14 и 7 дней. @alfa_appointments_bot 0Всего 0Просрочено 0Истекает ≤30 дней 0Истекает ≤90 дней Добавить Медцентр ↕ ФИО ↕ Специальность ↕ Срок действия ↕ Комментарий Действия Загрузка... Показано 1-20 из 100 Добавить запись × Медцентр * ФИО * Специальность * Срок действия * Комментарий Отмена Сохранить	{}	/page/akr	{}	2026-01-01 16:49:50.151+03	2026-01-01 22:45:18.004+03
bb00ba6e-3716-4527-b2fb-d7f6f8794c55	accreditation	775f3a70-71e7-436a-9f3f-769ee0eb02ca	Петров Владислав Александрович — Терапия	Петров Владислав Александрович | Терапия | Альфа | Тестовый врач	{альфа,терапия,аккредитация,сертификат,врач}	/page/accreditations?highlight=775f3a70-71e7-436a-9f3f-769ee0eb02ca	{"fullName": "Петров Владислав Александрович", "medCenter": "Альфа", "specialty": "Терапия", "expirationDate": "2026-01-02"}	2026-01-01 22:26:37.122+03	2026-01-01 22:26:37.122+03
69b92e5f-016c-4916-baef-badab224a516	accreditation	5911fa9d-2205-42fe-839d-89cb0878b0e3	Юдина Виктория Павловна — Гинекология	Юдина Виктория Павловна | Гинекология | Кидс | Проверка	{кидс,гинекология,аккредитация,сертификат,врач}	/page/accreditations?highlight=5911fa9d-2205-42fe-839d-89cb0878b0e3	{"fullName": "Юдина Виктория Павловна", "medCenter": "Кидс", "specialty": "Гинекология", "expirationDate": "2026-02-10"}	2026-01-01 22:27:03.902+03	2026-01-01 22:27:03.902+03
80509931-dbfe-47e5-83c6-088626d0c25d	accreditation	4d98aa18-082f-4206-a886-b5f691ea432c	Грудинкина Марина Владимировна — Стоматология	Грудинкина Марина Владимировна | Стоматология | Проф | Чек	{проф,стоматология,аккредитация,сертификат,врач}	/page/accreditations?highlight=4d98aa18-082f-4206-a886-b5f691ea432c	{"fullName": "Грудинкина Марина Владимировна", "medCenter": "Проф", "specialty": "Стоматология", "expirationDate": "2026-03-03"}	2026-01-01 22:27:43.223+03	2026-01-01 22:27:43.223+03
ca9e2509-f88d-4f3c-a440-4b336ebd99d0	accreditation	98bb7c25-2b83-4d13-bafa-59defc08ce12	Капкан Даниил Дмитриевич — Дерматология	Капкан Даниил Дмитриевич | Дерматология | Линия | Дерматовенеролог	{линия,дерматология,аккредитация,сертификат,врач}	/page/accreditations?highlight=98bb7c25-2b83-4d13-bafa-59defc08ce12	{"fullName": "Капкан Даниил Дмитриевич", "medCenter": "Линия", "specialty": "Дерматология", "expirationDate": "2026-04-04"}	2026-01-01 22:28:18.705+03	2026-01-01 22:28:18.705+03
3757489c-4419-4cf2-b0a4-1e6df3366b44	accreditation	3958a388-e83e-4fd8-a8e9-badcc97b1778	Стеценко Виталий Витальевич — Ортодонтия	Стеценко Виталий Витальевич | Ортодонтия | Смайл | Ортодонт	{смайл,ортодонтия,аккредитация,сертификат,врач}	/page/accreditations?highlight=3958a388-e83e-4fd8-a8e9-badcc97b1778	{"fullName": "Стеценко Виталий Витальевич", "medCenter": "Смайл", "specialty": "Ортодонтия", "expirationDate": "2026-05-05"}	2026-01-01 22:28:47.691+03	2026-01-01 22:28:47.691+03
98251a9f-a575-489b-be8b-c25fbdcf718c	accreditation	afa3fbc0-4905-459f-b66a-305acfcd8c35	Комиссаров Александр Сергеевич — Психотерапия	Комиссаров Александр Сергеевич | Психотерапия | 3К | Просрочен	{3к,психотерапия,аккредитация,сертификат,врач}	/page/accreditations?highlight=afa3fbc0-4905-459f-b66a-305acfcd8c35	{"fullName": "Комиссаров Александр Сергеевич", "medCenter": "3К", "specialty": "Психотерапия", "expirationDate": "2025-12-31"}	2026-01-01 22:29:28.721+03	2026-01-01 22:29:28.721+03
7d7e15be-6a0c-42b8-804b-98304013f453	page	55ea4bca-aa45-4d04-b676-948a90a50d01	Техобслуживание	Telegram-бот напоминаний Подпишитесь на бота, чтобы получать уведомления об истечении сроков страховки и о необходимости прохождения ТО. Открыть бота 0Всего ТС 0Просрочено 0Истекает ≤30 дней 0Скоро ТО (≤5000 км) Добавить Марка авто ↕ Организация ↕ Гос. номер ↕ Год ↕ Пробег / ТО ↕ Страховка ↕ Состояние ↕ Действия Загрузка... Показано 0–0 из 0 Добавить ТС × Марка авто * Организация * Гос. номер * Год авто * Пробег (км) * ТО на (км) * Страховка до * Состояние * Комментарий Отмена Сохранить	{}	/page/vehicles	{}	2026-01-01 23:17:50.14+03	2026-01-02 03:19:25.853+03
7f1b2b84-1123-42a7-9bbd-f2f289e5e8b4	page	c23073d8-4444-494b-ae53-b70518027d06	Аккредитации	Telegram-бот напоминаний Подпишитесь на бота, чтобы получать уведомления об истечении сроков аккредитаций за 90, 60, 30, 14 и 7 дней. @alfa_appointments_bot 0Всего 0Просрочено 0Истекает ≤30 дней 0Истекает ≤90 дней Добавить Медцентр ↕ ФИО ↕ Специальность ↕ Срок действия ↕ Комментарий Действия Загрузка... Показано 1-20 из 100 Добавить запись × Медцентр * ФИО * Специальность * Срок действия * Комментарий Отмена Сохранить	{}	/page/accreditations	{}	2026-01-01 22:43:41.681+03	2026-01-01 22:45:29.327+03
7c34c53a-95e6-4a7a-a6dd-65b110c8eb28	vehicle	5680e495-927e-419b-b9e6-6417e92ea10e	Мерседес GLS — М007КВ193	Мерседес GLS | Альфа | М007КВ193 | Хорошее	{альфа,"мерседес gls",м007кв193,авто,машина,транспорт,то,страховка}	/page/vehicles?highlight=5680e495-927e-419b-b9e6-6417e92ea10e	{"nextTO": 180000, "mileage": 178000, "carBrand": "Мерседес GLS", "licensePlate": "М007КВ193", "organization": "Альфа", "insuranceDate": "2025-12-17"}	2026-01-01 23:19:31.693+03	2026-01-01 23:19:31.693+03
2c812faa-9651-413e-a1ea-8d5af4075eab	vehicle	8a58b589-b046-4978-9af1-bc277eec8f3e	Suzuki Cresta — А1234АА1	Suzuki Cresta | Линия | А1234АА1 | Удовлетворительное	{линия,"suzuki cresta",а1234аа1,авто,машина,транспорт,то,страховка}	/page/vehicles?highlight=8a58b589-b046-4978-9af1-bc277eec8f3e	{"nextTO": 350000, "mileage": 150000, "carBrand": "Suzuki Cresta", "licensePlate": "А1234АА1", "organization": "Линия", "insuranceDate": "2026-12-31"}	2026-01-01 23:27:44.176+03	2026-01-01 23:27:44.176+03
db38bcea-b582-4182-bb2f-1ca98255a902	page	27dcbafb-81a3-4087-84d3-f0da8bb9b817	Карта	Интерактивная карта Нажмите на карту, чтобы добавить метку Легенда Добавить метку × Название * Описание Цвет / Категория Медиа файлы Загрузить файлы Отмена Сохранить × ×	{}	/page/map	{}	2026-01-02 12:38:35.256+03	2026-01-02 12:38:47.514+03
e7e6419f-941c-4880-9840-3b9fc049b83c	doctor	7e3342c4-12bc-4586-8ea2-89ddba2a6c99	Кривоносова Галина Алексеевна	Кривоносова Галина Алексеевна | 41 год	{stomatologi,врач,доктор,специалист}	/page/stomatologi?highlight=7e3342c4-12bc-4586-8ea2-89ddba2a6c99	{"photo": null, "fullName": "Кривоносова Галина Алексеевна", "pageSlug": "stomatologi", "specialty": "", "profileUrl": ""}	2026-01-02 20:15:48.75+03	2026-01-02 20:15:48.75+03
ee6ab147-9cb8-448c-b940-fe75e9e9b645	doctor	d53937c5-4712-43f8-a50b-492e5fbc25be	Кривова Юлия Владимировна — Стоматология	Кривова Юлия Владимировна | Стоматология | 20 лет | <p><strong>Тестовое описание</strong></p><p><em>Проверка</em></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><strong>Тестовое описание</strong></p><p><em>Проверка</em></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><strong>Тестовое описание</strong></p><p><em>Проверка</em></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p><p><u>Проверка</u></p> | на дому УЗИ КТ	{стоматология,stomatologi,врач,доктор,специалист,"на дому",узи,кт}	/page/stomatologi?highlight=d53937c5-4712-43f8-a50b-492e5fbc25be	{"tags": ["на дому", "УЗИ", "КТ"], "photo": null, "fullName": "Кривова Юлия Владимировна", "pageSlug": "stomatologi", "misUserId": "847", "specialty": "Стоматология", "profileUrl": "https://wikipedia.org"}	2026-01-02 19:14:37.097+03	2026-01-03 19:19:19.11+03
0a3cf08b-7be6-4652-a504-11d47dc6be3e	doctor	a665f7ab-4f9c-4ea9-8424-7003091dedbb	Сорокина Наталья Владимировна — Стоматология общей практики, Стоматология ортопедическая, Стоматология терапевтическая	Сорокина Наталья Владимировна | Стоматология общей практики, Стоматология ортопедическая, Стоматология терапевтическая | 14 лет | <p>Тестовая заметка</p>	{"стоматология общей практики, стоматология ортопедическая, стоматология терапевтическая",stomatologi,врач,доктор,специалист}	/page/stomatologi?highlight=a665f7ab-4f9c-4ea9-8424-7003091dedbb	{"tags": [], "photo": null, "fullName": "Сорокина Наталья Владимировна", "pageSlug": "stomatologi", "misUserId": "226", "specialty": "Стоматология общей практики, Стоматология ортопедическая, Стоматология терапевтическая", "profileUrl": ""}	2026-01-03 09:30:13.33+03	2026-01-03 19:16:35.31+03
984fe2b9-4a79-4521-9c90-ec3fed31a2df	page	f3db2edf-a40a-4699-a006-801c8b9dcbda	Стоматологи	Карточки врачей Карточки врачей Добавить врача Клиника: Теги: Загрузка... Добавить врача × Поиск врача в МИС ФИО * Специальность Стаж Возраст пац. Вн. номер Мобильный Ссылка Хэштеги (через запятую) Клиники Заметки Отмена Сохранить	{}	/page/stomatologi	{}	2026-01-02 15:52:12.793+03	2026-01-03 19:30:33.923+03
6f1fc990-5722-44fc-b92d-b0b2522e0d73	doctor	746340bb-14a6-4356-bbc4-2c7a55eee570	Трушкова Надежда Владимировна — Неврология	Трушкова Надежда Владимировна | Неврология | 21 год | <p>Тестовый врач</p> | невролог | Консультация врача-специалиста на дому ( г. Анапа) | Прием (осмотр, консультация) врача-невролога первичный | Прием (осмотр, консультация) врача-невролога повторный | Ботулинотерапия - лечение гипергидроза с использованием лекарственного препарата Релатокс | Ботулинотерапия - лечение хронической мигрени с использованием лекарственного препарата Релатокс | Ботулинотерапия - лечение дистонии с гипертонусом жевательных мышц с использованием лекарственного препарата Релатокс | Ботулинотерапия - лечение хронической мигрени с дистонией, гипертонусом жевательных мышц с использованием лекарственного препарата Релатокс | Ботулинотерапия - блокада миофасциальных триггерных точек с использованием лекарственного препарата Релатокс | Ботулинотерапия - введение лекарственного препарата Релатокс 1ед | Введение лекарственных препаратов в область периферического нерва (внутримышечные, периартикулярные инъекции) | Введение лекарственных препаратов в область периферического нерва с Дексаметазоном | Введение лекарственных препаратов в область периферического нерва с Дексаметазоном (повышенной сложности) | Введение лекарственных препаратов в область периферического нерва с Дипроспаном | Введение лекарственных препаратов в область периферического нерва по Фарберу | Подкожное введение лекарственных препаратов (плазмы обогащенной тромбоцитами 1 зона) | Введение препарата Фреманезумаб (Аджови) 1 инъекция | Телемедицинская консультация врача-невролога  | Бонусная программа "Первый пациент"	{неврология,stomatologi,врач,доктор,специалист,невролог,консультация,врача-специалиста,прием,"(осмотр,",ботулинотерапия,-,введение,лекарственных,подкожное,препарата,телемедицинская,бонусная,программа}	/page/stomatologi?highlight=746340bb-14a6-4356-bbc4-2c7a55eee570	{"tags": ["невролог"], "photo": null, "fullName": "Трушкова Надежда Владимировна", "pageSlug": "stomatologi", "misUserId": "1792", "specialty": "Неврология", "profileUrl": "", "servicesCount": 18}	2026-01-03 19:46:36.934+03	2026-01-03 19:46:36.934+03
2cfec9d3-275c-438c-9cb8-e1908ba74d1e	page	f847df2d-eda6-44bd-aea7-b7ce031dd632	Гинекологи	Карточки врачей Карточки врачей Добавить врача Загрузка... Добавить врача × Поиск врача в МИС ФИО * Специальность Стаж Возраст пациентов Ссылка на страницу Внутренний номер Мобильный Клиники Заметки Отмена Сохранить	{}	/page/ginekologi	{}	2026-01-03 09:32:17.524+03	2026-01-03 15:24:02.861+03
04c5f431-f5bf-4996-89e8-4c79e31e694a	doctor	30670876-baee-419d-a96e-d581e46d4146	Кривова Юлия Владимировна — Стоматология детская, Стоматология общей практики, Стоматология терапевтическая	Кривова Юлия Владимировна | Стоматология детская, Стоматология общей практики, Стоматология терапевтическая | 20 лет	{"стоматология детская, стоматология общей практики, стоматология терапевтическая",ginekologi,врач,доктор,специалист}	/page/ginekologi?highlight=30670876-baee-419d-a96e-d581e46d4146	{"photo": null, "fullName": "Кривова Юлия Владимировна", "pageSlug": "ginekologi", "specialty": "Стоматология детская, Стоматология общей практики, Стоматология терапевтическая", "profileUrl": ""}	2026-01-03 14:43:34.167+03	2026-01-03 15:24:38.94+03
1f3862ad-1f53-4b96-97f4-98840bfb9429	doctor	ecb18119-31b3-44ed-a7ae-c50f3e7e0bc8	Кульченко Дмитрий Валерьевич — Аллергология и иммунология, Пульмонология	Кульченко Дмитрий Валерьевич | Аллергология и иммунология, Пульмонология | 19 лет | Проверка	{"аллергология и иммунология, пульмонология",ginekologi,врач,доктор,специалист}	/page/ginekologi?highlight=ecb18119-31b3-44ed-a7ae-c50f3e7e0bc8	{"photo": null, "fullName": "Кульченко Дмитрий Валерьевич", "pageSlug": "ginekologi", "specialty": "Аллергология и иммунология, Пульмонология", "profileUrl": ""}	2026-01-03 09:32:39.503+03	2026-01-03 15:25:21.518+03
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.settings (key, value, description, "createdAt", "updatedAt") FROM stdin;
siteName	"Alfa Wiki"	Название сайта	2025-12-31 16:44:18.258+03	2025-12-31 16:44:18.258+03
siteDescription	"База знаний медицинского центра"	Описание сайта	2025-12-31 16:44:18.261+03	2025-12-31 16:44:18.261+03
primaryColor	"#007AFF"	Основной цвет	2025-12-31 16:44:18.262+03	2025-12-31 16:44:18.262+03
accentColor	"#5856D6"	Акцентный цвет	2025-12-31 16:44:18.263+03	2025-12-31 16:44:18.263+03
logo	\N	URL логотипа	2025-12-31 16:44:18.265+03	2025-12-31 16:44:18.265+03
defaultRole	"e32c4a52-7d28-4f35-8580-0b4bc702d9dc"	Роль по умолчанию	2025-12-31 16:44:18.267+03	2025-12-31 16:44:18.267+03
allowRegistration	false	Разрешить регистрацию	2025-12-31 16:44:18.269+03	2025-12-31 16:44:18.269+03
\.


--
-- Data for Name: sidebar_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sidebar_items (id, type, title, icon, "pageId", "folderId", "externalUrl", "parentId", "sortOrder", "isExpanded", "allowedRoles", "isVisible", "createdAt", "updatedAt") FROM stdin;
35901787-884e-4c51-87f7-7884ccbf227d	folder	\N	\N	\N	e2928484-6bbc-4f29-8016-ecf0df98d02f	\N	\N	3	t	{}	t	2026-01-01 22:44:00.858+03	2026-01-01 22:44:00.858+03
\.


--
-- Data for Name: telegram_subscribers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.telegram_subscribers (id, "chatId", username, "firstName", "lastName", "isActive", "createdAt", "updatedAt", "subscribeAccreditations", "subscribeVehicles") FROM stdin;
28b99956-608f-4499-b0c1-75bf92e4dbf3	1223909732	visterione	Vitalii	Stetsenko	t	2026-01-01 17:26:12.38+03	2026-01-02 03:30:53.335+03	t	t
\.


--
-- Data for Name: user_favorites; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_favorites (id, "userId", "pageId", "sortOrder", "createdAt", "updatedAt") FROM stdin;
4f112560-0378-46bc-9247-67ade02f5327	73e7e5ea-13eb-4509-bed7-441541ed1447	af343927-d7d7-4d4a-b492-920e7349aa8c	1	2026-01-01 18:03:51.652+03	2026-01-01 18:03:51.652+03
4693b6ef-5e2e-4af7-86ce-a90b197e839b	73e7e5ea-13eb-4509-bed7-441541ed1447	c23073d8-4444-494b-ae53-b70518027d06	2	2026-01-03 16:22:54.161+03	2026-01-03 16:22:54.161+03
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, password, "displayName", email, avatar, "isActive", "isAdmin", "lastLogin", settings, "createdAt", "updatedAt", "roleId") FROM stdin;
73e7e5ea-13eb-4509-bed7-441541ed1447	admin	$2a$12$6MKjY6fRK/GJ5B3ft8SkGez0YVMvZ2nO80Fb2hXmrh/2EkO7Yd0ye	Администратор	admin@example.com	uploads/2026-01/9b124d8e-b061-4a96-8155-b7d86bafd485.webp	t	t	2026-01-03 12:13:58.044+03	{}	2025-12-31 16:44:18.254+03	2026-01-03 16:22:25.082+03	383e506b-08ad-43e6-ba36-405298347163
c575d874-1e15-447f-b2cf-90f4ae8a69b8	test2	$2a$12$8PxcNdgOlzCNyCHLkSUQ9OhXlOZRH/zZvgsWwgSYOo4z3sgq0haPO	test2	\N	\N	t	f	\N	{}	2026-01-03 19:49:21.366+03	2026-01-03 19:49:21.366+03	e32c4a52-7d28-4f35-8580-0b4bc702d9dc
476cbc64-17c4-461a-9a16-be5e24e6fcf0	test	$2a$12$ZY7Q3eipqZsDEuSmI0ZHEeAtqeuJENSuz9Ck9LSq40vXCyyZkK3VK	test	\N	\N	t	f	2026-01-03 19:49:43.693+03	{}	2026-01-03 19:49:07.448+03	2026-01-03 19:49:43.694+03	e32c4a52-7d28-4f35-8580-0b4bc702d9dc
\.


--
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicles (id, organization, "carBrand", "licensePlate", "carYear", mileage, "nextTO", "insuranceDate", condition, comment, reminded90, reminded60, reminded30, reminded14, reminded7, "remindedTO", "createdAt", "updatedAt") FROM stdin;
5680e495-927e-419b-b9e6-6417e92ea10e	Альфа	Мерседес GLS	М007КВ193	2018	178000	180000	2025-12-17	Хорошее		f	f	f	f	f	f	2026-01-01 23:19:31.669+03	2026-01-01 23:19:31.669+03
8a58b589-b046-4978-9af1-bc277eec8f3e	Линия	Suzuki Cresta	А1234АА1	2021	150000	350000	2026-12-31	Удовлетворительное		f	f	f	f	f	f	2026-01-01 23:27:44.15+03	2026-01-01 23:27:44.15+03
\.


--
-- Name: accreditations accreditations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accreditations
    ADD CONSTRAINT accreditations_pkey PRIMARY KEY (id);


--
-- Name: chat_members chat_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: doctor_cards doctor_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_cards
    ADD CONSTRAINT doctor_cards_pkey PRIMARY KEY (id);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: map_markers map_markers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.map_markers
    ADD CONSTRAINT map_markers_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: pages pages_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key UNIQUE (slug);


--
-- Name: pages pages_slug_key1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key1 UNIQUE (slug);


--
-- Name: pages pages_slug_key10; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key10 UNIQUE (slug);


--
-- Name: pages pages_slug_key11; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key11 UNIQUE (slug);


--
-- Name: pages pages_slug_key12; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key12 UNIQUE (slug);


--
-- Name: pages pages_slug_key13; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key13 UNIQUE (slug);


--
-- Name: pages pages_slug_key14; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key14 UNIQUE (slug);


--
-- Name: pages pages_slug_key15; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key15 UNIQUE (slug);


--
-- Name: pages pages_slug_key16; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key16 UNIQUE (slug);


--
-- Name: pages pages_slug_key17; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key17 UNIQUE (slug);


--
-- Name: pages pages_slug_key18; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key18 UNIQUE (slug);


--
-- Name: pages pages_slug_key2; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key2 UNIQUE (slug);


--
-- Name: pages pages_slug_key3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key3 UNIQUE (slug);


--
-- Name: pages pages_slug_key4; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key4 UNIQUE (slug);


--
-- Name: pages pages_slug_key5; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key5 UNIQUE (slug);


--
-- Name: pages pages_slug_key6; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key6 UNIQUE (slug);


--
-- Name: pages pages_slug_key7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key7 UNIQUE (slug);


--
-- Name: pages pages_slug_key8; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key8 UNIQUE (slug);


--
-- Name: pages pages_slug_key9; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key9 UNIQUE (slug);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_name_key1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key1 UNIQUE (name);


--
-- Name: roles roles_name_key10; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key10 UNIQUE (name);


--
-- Name: roles roles_name_key11; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key11 UNIQUE (name);


--
-- Name: roles roles_name_key12; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key12 UNIQUE (name);


--
-- Name: roles roles_name_key13; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key13 UNIQUE (name);


--
-- Name: roles roles_name_key14; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key14 UNIQUE (name);


--
-- Name: roles roles_name_key15; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key15 UNIQUE (name);


--
-- Name: roles roles_name_key16; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key16 UNIQUE (name);


--
-- Name: roles roles_name_key17; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key17 UNIQUE (name);


--
-- Name: roles roles_name_key18; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key18 UNIQUE (name);


--
-- Name: roles roles_name_key2; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key2 UNIQUE (name);


--
-- Name: roles roles_name_key3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key3 UNIQUE (name);


--
-- Name: roles roles_name_key4; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key4 UNIQUE (name);


--
-- Name: roles roles_name_key5; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key5 UNIQUE (name);


--
-- Name: roles roles_name_key6; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key6 UNIQUE (name);


--
-- Name: roles roles_name_key7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key7 UNIQUE (name);


--
-- Name: roles roles_name_key8; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key8 UNIQUE (name);


--
-- Name: roles roles_name_key9; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key9 UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: search_index search_index_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.search_index
    ADD CONSTRAINT search_index_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: sidebar_items sidebar_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sidebar_items
    ADD CONSTRAINT sidebar_items_pkey PRIMARY KEY (id);


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key1" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key10; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key10" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key11; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key11" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key12; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key12" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key13; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key13" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key14; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key14" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key15; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key15" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key16; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key16" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key2; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key2" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key3" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key4; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key4" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key5; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key5" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key6; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key6" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key7" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key8; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key8" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_chatId_key9; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT "telegram_subscribers_chatId_key9" UNIQUE ("chatId");


--
-- Name: telegram_subscribers telegram_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_subscribers
    ADD CONSTRAINT telegram_subscribers_pkey PRIMARY KEY (id);


--
-- Name: user_favorites user_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: users users_username_key1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key1 UNIQUE (username);


--
-- Name: users users_username_key10; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key10 UNIQUE (username);


--
-- Name: users users_username_key11; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key11 UNIQUE (username);


--
-- Name: users users_username_key12; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key12 UNIQUE (username);


--
-- Name: users users_username_key13; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key13 UNIQUE (username);


--
-- Name: users users_username_key14; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key14 UNIQUE (username);


--
-- Name: users users_username_key15; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key15 UNIQUE (username);


--
-- Name: users users_username_key16; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key16 UNIQUE (username);


--
-- Name: users users_username_key17; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key17 UNIQUE (username);


--
-- Name: users users_username_key18; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key18 UNIQUE (username);


--
-- Name: users users_username_key2; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key2 UNIQUE (username);


--
-- Name: users users_username_key3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key3 UNIQUE (username);


--
-- Name: users users_username_key4; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key4 UNIQUE (username);


--
-- Name: users users_username_key5; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key5 UNIQUE (username);


--
-- Name: users users_username_key6; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key6 UNIQUE (username);


--
-- Name: users users_username_key7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key7 UNIQUE (username);


--
-- Name: users users_username_key8; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key8 UNIQUE (username);


--
-- Name: users users_username_key9; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key9 UNIQUE (username);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: accreditations_expiration_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX accreditations_expiration_date ON public.accreditations USING btree ("expirationDate");


--
-- Name: accreditations_full_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX accreditations_full_name ON public.accreditations USING btree ("fullName");


--
-- Name: accreditations_med_center; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX accreditations_med_center ON public.accreditations USING btree ("medCenter");


--
-- Name: accreditations_specialty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX accreditations_specialty ON public.accreditations USING btree (specialty);


--
-- Name: chat_members_chat_id_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chat_members_chat_id_user_id ON public.chat_members USING btree ("chatId", "userId");


--
-- Name: doctor_cards_full_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_cards_full_name ON public.doctor_cards USING btree ("fullName");


--
-- Name: doctor_cards_page_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_cards_page_slug ON public.doctor_cards USING btree ("pageSlug");


--
-- Name: doctor_cards_sort_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_cards_sort_order ON public.doctor_cards USING btree ("sortOrder");


--
-- Name: doctor_cards_specialty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_cards_specialty ON public.doctor_cards USING btree (specialty);


--
-- Name: folders_parent_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX folders_parent_id ON public.folders USING btree ("parentId");


--
-- Name: folders_sort_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX folders_sort_order ON public.folders USING btree ("sortOrder");


--
-- Name: idx_accreditations_expdate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accreditations_expdate ON public.accreditations USING btree ("expirationDate");


--
-- Name: idx_accreditations_fullname; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accreditations_fullname ON public.accreditations USING btree ("fullName");


--
-- Name: idx_accreditations_medcenter; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accreditations_medcenter ON public.accreditations USING btree ("medCenter");


--
-- Name: idx_accreditations_specialty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accreditations_specialty ON public.accreditations USING btree (specialty);


--
-- Name: idx_doctor_cards_full_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_doctor_cards_full_name ON public.doctor_cards USING btree ("fullName");


--
-- Name: idx_doctor_cards_mis_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_doctor_cards_mis_user_id ON public.doctor_cards USING btree ("misUserId");


--
-- Name: idx_doctor_cards_page_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_doctor_cards_page_slug ON public.doctor_cards USING btree ("pageSlug");


--
-- Name: idx_doctor_cards_sort_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_doctor_cards_sort_order ON public.doctor_cards USING btree ("sortOrder");


--
-- Name: idx_doctor_cards_specialty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_doctor_cards_specialty ON public.doctor_cards USING btree (specialty);


--
-- Name: idx_map_markers_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_map_markers_category ON public.map_markers USING btree (category);


--
-- Name: idx_map_markers_color; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_map_markers_color ON public.map_markers USING btree (color);


--
-- Name: idx_map_markers_coords; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_map_markers_coords ON public.map_markers USING btree (lat, lng);


--
-- Name: idx_map_markers_created_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_map_markers_created_by ON public.map_markers USING btree ("createdBy");


--
-- Name: idx_vehicles_carbrand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_carbrand ON public.vehicles USING btree ("carBrand");


--
-- Name: idx_vehicles_condition; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_condition ON public.vehicles USING btree (condition);


--
-- Name: idx_vehicles_insurancedate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_insurancedate ON public.vehicles USING btree ("insuranceDate");


--
-- Name: idx_vehicles_licenseplate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_licenseplate ON public.vehicles USING btree ("licensePlate");


--
-- Name: idx_vehicles_mileage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_mileage ON public.vehicles USING btree (mileage);


--
-- Name: idx_vehicles_nextto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_nextto ON public.vehicles USING btree ("nextTO");


--
-- Name: idx_vehicles_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_organization ON public.vehicles USING btree (organization);


--
-- Name: map_markers_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX map_markers_category ON public.map_markers USING btree (category);


--
-- Name: map_markers_color; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX map_markers_color ON public.map_markers USING btree (color);


--
-- Name: map_markers_lat_lng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX map_markers_lat_lng ON public.map_markers USING btree (lat, lng);


--
-- Name: pages_folder_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pages_folder_id ON public.pages USING btree ("folderId");


--
-- Name: pages_keywords; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pages_keywords ON public.pages USING btree (keywords);


--
-- Name: pages_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pages_slug ON public.pages USING btree (slug);


--
-- Name: pages_title; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pages_title ON public.pages USING btree (title);


--
-- Name: search_index_entity_type_entity_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX search_index_entity_type_entity_id ON public.search_index USING btree ("entityType", "entityId");


--
-- Name: search_index_keywords; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX search_index_keywords ON public.search_index USING btree (keywords);


--
-- Name: user_favorites_user_id_page_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_favorites_user_id_page_id ON public.user_favorites USING btree ("userId", "pageId");


--
-- Name: vehicles_car_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_car_brand ON public.vehicles USING btree ("carBrand");


--
-- Name: vehicles_condition; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_condition ON public.vehicles USING btree (condition);


--
-- Name: vehicles_insurance_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_insurance_date ON public.vehicles USING btree ("insuranceDate");


--
-- Name: vehicles_license_plate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_license_plate ON public.vehicles USING btree ("licensePlate");


--
-- Name: vehicles_mileage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_mileage ON public.vehicles USING btree (mileage);


--
-- Name: vehicles_next_t_o; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_next_t_o ON public.vehicles USING btree ("nextTO");


--
-- Name: vehicles_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX vehicles_organization ON public.vehicles USING btree (organization);


--
-- Name: chat_members chat_members_chatId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT "chat_members_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_members chat_members_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT "chat_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE;


--
-- Name: folders folders_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT "folders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE;


--
-- Name: folders folders_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public.folders(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: map_markers map_markers_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.map_markers
    ADD CONSTRAINT "map_markers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE;


--
-- Name: media media_uploadedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT "media_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: messages messages_chatId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: messages messages_replyToId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES public.messages(id) ON UPDATE CASCADE;


--
-- Name: messages messages_senderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES public.users(id) ON UPDATE CASCADE;


--
-- Name: pages pages_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT "pages_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: pages pages_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT "pages_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public.folders(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: pages pages_updatedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT "pages_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sidebar_items sidebar_items_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sidebar_items
    ADD CONSTRAINT "sidebar_items_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public.folders(id) ON UPDATE CASCADE;


--
-- Name: sidebar_items sidebar_items_pageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sidebar_items
    ADD CONSTRAINT "sidebar_items_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES public.pages(id) ON UPDATE CASCADE;


--
-- Name: sidebar_items sidebar_items_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sidebar_items
    ADD CONSTRAINT "sidebar_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public.sidebar_items(id) ON UPDATE CASCADE;


--
-- Name: user_favorites user_favorites_pageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT "user_favorites_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES public.pages(id) ON UPDATE CASCADE;


--
-- Name: user_favorites user_favorites_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT "user_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE;


--
-- Name: users users_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict aJuieidNvcBlboQ6KUJV0OKDuEodEo0ta8cA3lGvQPxX5lgNrsyrboYD4CcdrLD

